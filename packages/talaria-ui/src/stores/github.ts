import { create } from "zustand";
import db, {
  type Deployment,
  type GitHubConnection,
  type GitHubConnectionType,
} from "../db";
import { hermesClient } from "../services/hermes";
import {
  DirectGitHubTransport,
  GatewayGitHubTransport,
  githubClient,
  type CheckRun,
  type ChecksSummary,
  type DeviceFlowHandle,
  type WorkflowMeta,
  type WorkflowRun,
} from "../services/github";

// Detect the desktop (Tauri) shell at runtime. The desktop shell does the
// device-flow exchange natively (direct transport); the web/PWA routes through
// the user's own Hermes gateway (gateway transport).
function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type DeviceFlowState = {
  active: boolean;
  handle: DeviceFlowHandle | null;
  error: string | null;
  polling: boolean;
};

export type GitHubState = {
  connections: Array<GitHubConnection>;
  deviceFlow: DeviceFlowState;
  platform: "desktop" | "web";

  init: () => Promise<void>;
  loadConnections: () => Promise<void>;
  transportKind: () => "direct" | "gateway";

  // Device flow
  startDeviceFlow: () => Promise<void>;
  stopDeviceFlow: () => void;
  pollDeviceFlow: () => Promise<void>;

  // PAT fallback
  connectWithPat: (token: string) => Promise<void>;

  // Token lifecycle
  disconnect: (owner: string) => Promise<void>;
  markReconnecting: (owner: string) => Promise<void>;

  // CI status (workflow-spec §7)
  activeToken: () => Promise<string | null>;
  fetchCheckRuns: (owner: string, repo: string, ref: string) => Promise<Array<CheckRun>>;
  fetchWorkflowRuns: (owner: string, repo: string, branch: string) => Promise<Array<WorkflowRun>>;
  checkRunsForPr: (
    owner: string,
    repo: string,
    headSha: string,
    required: Array<string>
  ) => Promise<{ summary: ChecksSummary; runs: Array<CheckRun> }>;

  // Deployments (workflow-spec §8) — dispatchable workflows, trigger, watch.
  deployments: Array<Deployment>;
  listDispatchableWorkflows: (owner: string, repo: string) => Promise<Array<WorkflowMeta>>;
  loadDeployments: (project: string | null) => Promise<void>;
  dispatchDeployment: (opts: {
    owner: string;
    repo: string;
    workflowId: number;
    workflowName: string;
    ref: string;
    inputs?: Record<string, string>;
    project: string | null;
  }) => Promise<Deployment>;
  refreshDeployment: (dep: Deployment) => Promise<Deployment>;
};

// Web keeps only an opaque token_ref (the gateway holds the token); desktop
// holds the raw token locally keyed by owner.
const tokenSettingsKey = (owner: string) => `github:token:${owner}`;

export const useGitHubStore = create<GitHubState>((set, get) => ({
  connections: [],
  deviceFlow: { active: false, handle: null, error: null, polling: false },
  platform: isDesktop() ? "desktop" : "web",
  deployments: [],

  async init() {
    // Configure the transport for this shell.
    if (get().platform === "desktop") {
      githubClient.setTransport(new DirectGitHubTransport());
    } else {
      githubClient.setTransport(
        new GatewayGitHubTransport(hermesClient.gatewayRoot(), hermesClient.apiKey)
      );
    }
    await get().loadConnections();
  },

  async loadConnections() {
    const connections = await db.connections.toArray();
    set({ connections });
  },

  transportKind: () => (get().platform === "desktop" ? "direct" : "gateway"),

  async startDeviceFlow() {
    set({ deviceFlow: { active: true, handle: null, error: null, polling: false } });
    try {
      const handle = await githubClient.connectDeviceFlow();
      set({ deviceFlow: { active: true, handle, error: null, polling: false } });
    } catch (err) {
      set({
        deviceFlow: {
          active: true,
          handle: null,
          error: err instanceof Error ? err.message : "Could not start GitHub device flow",
          polling: false,
        },
      });
    }
  },

  stopDeviceFlow() {
    set({ deviceFlow: { active: false, handle: null, error: null, polling: false } });
  },

  async pollDeviceFlow() {
    const { handle } = get().deviceFlow;
    if (!handle || !handle.device_code) return;
    set({ deviceFlow: { ...get().deviceFlow, polling: true, error: null } });
    try {
      const result = await githubClient.pollDeviceFlow(handle.device_code);
      if (result.status === "success") {
        // Desktop: the app received the token directly.
        if (result.access_token) {
          githubClient.setToken(result.access_token);
        } else if (result.token_ref) {
          githubClient.tokenRef = result.token_ref;
        }
        // Verify and persist the connection.
        const { login } = await githubClient.verifyConnection();
        const type: GitHubConnectionType = "device";
        const gatewayOrigin =
          get().platform === "desktop" ? "" : hermesClient.gatewayRoot();
        const tokenRef =
          get().platform === "desktop"
            ? tokenSettingsKey(login)
            : result.token_ref || "";
        if (get().platform === "desktop" && result.access_token) {
          await db.settings.put({ key: tokenSettingsKey(login), value: result.access_token });
        }
        const now = Date.now();
        await db.connections.put({
          id: login,
          owner: login,
          type,
          status: "connected",
          scopes: [],
          tokenRef,
          gatewayOrigin,
          lastVerifiedAt: now,
          connectedAt: now,
        });
        await get().loadConnections();
        set({ deviceFlow: { active: false, handle: null, error: null, polling: false } });
        return;
      }
      if (result.status === "denied" || result.status === "expired") {
        set({
          deviceFlow: {
            ...get().deviceFlow,
            polling: false,
            error: result.status === "denied" ? "Authorization denied." : "Device code expired. Start again.",
          },
        });
        return;
      }
      // pending — keep polling
      set({ deviceFlow: { ...get().deviceFlow, polling: false } });
    } catch (err) {
      set({
        deviceFlow: {
          ...get().deviceFlow,
          polling: false,
          error: err instanceof Error ? err.message : "Polling failed",
        },
      });
    }
  },

  async connectWithPat(token) {
    const trimmed = (token || "").trim();
    if (!trimmed) throw new Error("Paste a token first");
    // Verify against GitHub before storing anything.
    const { login } = await githubClient.verifyConnection(trimmed);
    const gatewayOrigin = get().platform === "desktop" ? "" : hermesClient.gatewayRoot();
    const tokenRef = tokenSettingsKey(login);
    // Store the token locally (Dexie settings) — on the user's machine, never
    // on a Talaria server. On web the request path routes through the gateway
    // proxy, which reads the token it holds; the browser keeps only the ref.
    await db.settings.put({ key: tokenRef, value: trimmed });
    const now = Date.now();
    await db.connections.put({
      id: login,
      owner: login,
      type: "pat",
      status: "connected",
      scopes: [],
      tokenRef,
      gatewayOrigin,
      lastVerifiedAt: now,
      connectedAt: now,
    });
    await get().loadConnections();
  },

  async disconnect(owner) {
    const conn = await db.connections.get(owner);
    if (conn) {
      await db.settings.delete(conn.tokenRef).catch(() => {});
    }
    await db.connections.delete(owner);
    await get().loadConnections();
  },

  async markReconnecting(owner) {
    await db.connections.update(owner, { status: "reconnecting" });
    await get().loadConnections();
  },

  // CI status (workflow-spec §7) — every call hits the live GitHub API via the
  // configured transport (never a stale cache for gates, P1). Ensure the active
  // connection's stored token is loaded onto the client (direct transport)
  // before each call so the request authenticates, even after a reload.
  async activeToken(): Promise<string | null> {
    const conns = get().connections;
    if (conns.length === 0) return githubClient.token;
    // Prefer the most recently connected account.
    const active = conns.reduce((a, b) => (b.lastVerifiedAt > a.lastVerifiedAt ? b : a));
    if (get().platform === "desktop") {
      const stored = await db.settings.get(active.tokenRef);
      return stored?.value ?? githubClient.token;
    }
    // Web: gateway holds the token; client.token may already be a ref.
    return githubClient.token;
  },

  async fetchCheckRuns(owner, repo, ref) {
    const token = await get().activeToken();
    if (get().platform === "desktop" && token) githubClient.setToken(token);
    return githubClient.getCheckRuns(owner, repo, ref);
  },

  async fetchWorkflowRuns(owner, repo, branch) {
    const token = await get().activeToken();
    if (get().platform === "desktop" && token) githubClient.setToken(token);
    return githubClient.getWorkflowRuns(owner, repo, { branch });
  },

  async checkRunsForPr(owner, repo, headSha, required) {
    const token = await get().activeToken();
    if (get().platform === "desktop" && token) githubClient.setToken(token);
    return githubClient.checkRunsForPr(owner, repo, headSha, required);
  },

  // ── Deployments (workflow-spec §8) ────────────────────────────────────────
  // Live GitHub API for the trigger and every status poll (never a stale cache
  // for a dispatch, P1); Dexie only caches completed runs for offline reads.

  // Ensure the active connection's token is loaded, then list dispatchable
  // workflows for a repo. Returns only `active` (dispatchable) workflows.
  async listDispatchableWorkflows(owner, repo) {
    const token = await get().activeToken();
    if (get().platform === "desktop" && token) githubClient.setToken(token);
    const all = await githubClient.listWorkflows(owner, repo);
    return githubClient.listDispatchableWorkflows(all);
  },

  // Load cached deployments for a project scope (P9) — offline-read friendly.
  async loadDeployments(project) {
    let rows: Array<Deployment>;
    if (project) {
      rows = await db.deployments.where("project").equals(project).sortBy("triggeredAt");
    } else {
      rows = await db.deployments.toArray();
      rows.sort((a, b) => b.triggeredAt - a.triggeredAt);
    }
    set({ deployments: rows.reverse() }); // newest first
  },

  // Trigger a workflow_dispatch deployment and start watching it. Returns the
  // freshly-persisted Deployment so the caller can render + poll it.
  async dispatchDeployment({ owner, repo, workflowId, workflowName, ref, inputs, project }) {
    const token = await get().activeToken();
    if (get().platform === "desktop" && token) githubClient.setToken(token);
    const repoId = `${owner}/${repo}`;
    const now = Date.now();
    // Optimistic row before the dispatch resolves — runId 0, url to the
    // workflow page. Upserted with the real run once the run appears.
    const optimistic: Deployment = {
      id: `${repoId}:0`,
      repoId,
      owner,
      repo,
      runId: 0,
      workflow: workflowName,
      workflowDisplay: workflowName,
      ref,
      inputs: inputs || {},
      headSha: "",
      status: "queued",
      conclusion: null,
      triggeredAt: now,
      url: `https://github.com/${repoId}/actions/workflows`,
      project,
    };
    await db.deployments.put(optimistic);

    // Fire the dispatch — GitHub returns 204 with no body and no run id, so we
    // watch for the run it creates by listing runs on the ref.
    await githubClient.dispatchWorkflow(owner, repo, workflowId, { ref, inputs });

    // Poll (a few quick tries) for the run this dispatch created: the newest
    // workflow_dispatch run on the ref with the matching workflow name.
    let run: WorkflowRun | null = null;
    for (let i = 0; i < 10 && !run; i++) {
      const runs = await githubClient.getWorkflowRuns(owner, repo, { branch: ref });
      run =
        runs.find((r) => r.event === "workflow_dispatch" && r.name === workflowName) ||
        null;
      if (!run) {
        // Sleep ~1.5s between polls (GitHub propagates the run asynchronously).
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    const deployment: Deployment = run
      ? {
          id: `${repoId}:${run.id}`,
          repoId,
          owner,
          repo,
          runId: run.id,
          workflow: workflowName,
          workflowDisplay: run.displayTitle || workflowName,
          ref: run.headBranch || ref,
          inputs: inputs || {},
          headSha: run.headSha,
          status: run.status === "completed" ? "completed" : "in_progress",
          conclusion: run.conclusion,
          triggeredAt: now,
          url: run.htmlUrl,
          project,
        }
      : optimistic;

    await db.deployments.put(deployment);
    await db.deployments.delete(`${repoId}:0`).catch(() => {});
    await get().loadDeployments(project);
    return deployment;
  },

  // Watch a single deployment: fetch its live workflow run, persist the
  // updated status/conclusion, and return the refreshed row.
  async refreshDeployment(dep) {
    const token = await get().activeToken();
    if (get().platform === "desktop" && token) githubClient.setToken(token);
    if (!dep.runId) return dep;
    const run = await githubClient.getWorkflowRun(dep.owner, dep.repo, dep.runId);
    const updated: Deployment = {
      ...dep,
      runId: run.id,
      workflowDisplay: run.displayTitle || dep.workflowDisplay,
      headSha: run.headSha || dep.headSha,
      status: run.status === "completed" ? "completed" : "in_progress",
      conclusion: run.conclusion,
      url: run.htmlUrl,
      updated: Date.now(),
    } as Deployment;
    await db.deployments.put(updated);
    await get().loadDeployments(dep.project);
    return updated;
  },
}));
