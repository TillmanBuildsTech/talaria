import { useCallback, useEffect, useMemo, useState } from "react";
import { useGitHubStore } from "../stores/github";
import { useReposStore } from "../stores/repos";
import { useChatStore } from "../stores/chat";
import { getVercelKeyConfigured, saveVercelApiKey } from "../services/vercel-key";
import { GitRepoNotice } from "./git-repo-notice";
import { VercelKeyPrompt } from "./vercel-key-prompt";
import type { Deployment } from "../db";
import type { WorkflowMeta } from "../services/github";

// ---------------------------------------------------------------------------
// Deployments (workflow-spec §8) — one pane of glass for triggering and
// watching workflow_dispatch deployments, tagged by project (P9).
//
//   - TriggerForm: pick a connected repo → pick a dispatchable workflow →
//     set the ref + optional inputs → dispatch. Every error surfaces GitHub's
//     real message (422 for non-dispatchable workflow / bad ref, §11).
//   - DeploymentRow / DeploymentList: cached deployments for the current
//     project scope, each linking back to its GitHub run (P3), with live
//     status watch (auto-poll while in_progress).
//
// Pure status mapping (statusText, outcomeOf, pollCadence) is unit-tested in
// github.test.ts. The component itself is self-contained — both shells mount
// it via the shared App (P6); it talks only to the github store.
// ---------------------------------------------------------------------------

const statusStyles = {
  queued: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  in_progress: "bg-blue-500/15 text-blue-300 ring-blue-500/30",
  completed: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
} as const;

const conclusionStyles: Record<string, string> = {
  success: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  failure: "bg-red-500/15 text-red-300 ring-red-500/30",
  cancelled: "bg-slate-500/15 text-slate-300 ring-slate-500/30",
  skipped: "bg-slate-500/15 text-slate-300 ring-slate-500/30",
  neutral: "bg-slate-500/15 text-slate-300 ring-slate-500/30",
  timed_out: "bg-red-500/15 text-red-300 ring-red-500/30",
  startup_failure: "bg-red-500/15 text-red-300 ring-red-500/30",
};

export function deploymentStatusText(dep: Deployment): string {
  if (dep.status === "completed") return dep.conclusion || "completed";
  return dep.status.replace("_", " ");
}

export function deploymentOutcome(dep: Deployment): "pass" | "fail" | "pending" {
  if (dep.status !== "completed") return "pending";
  if (dep.conclusion === "success") return "pass";
  if (dep.conclusion === "skipped" || dep.conclusion === "neutral") return "pass";
  return "fail";
}

// Poll every 30s while a deployment is still running (queued / in_progress),
// mirroring the chat health-check cadence (workflow-spec §7).
export const DEPLOYMENT_POLL_MS = 30_000;

function DeploymentRow({ dep, onRefresh }: { dep: Deployment; onRefresh: (d: Deployment) => void }) {
  const refreshDeployment = useGitHubStore((s) => s.refreshDeployment);
  const outcome = deploymentOutcome(dep);
  const dot = outcome === "pass" ? "bg-emerald-400" : outcome === "fail" ? "bg-red-400" : "bg-amber-400";
  const badge = dep.status === "completed" ? conclusionStyles[dep.conclusion || ""] : statusStyles[dep.status];

  return (
    <li className="flex items-center justify-between gap-2 py-2 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-slate-200">{dep.workflowDisplay}</span>
            <span className="shrink-0 text-xs text-slate-500">
              {dep.repo} · {dep.ref}
            </span>
            {dep.runId > 0 && <span className="shrink-0 text-xs text-slate-500">#{dep.runId}</span>}
          </div>
          {Object.keys(dep.inputs || {}).length > 0 && (
            <div className="truncate text-xs text-slate-500">
              {Object.entries(dep.inputs)
                .map(([k, v]) => `${k}=${v}`)
                .join(" · ")}
            </div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-xs ring-1 ${badge}`}>{deploymentStatusText(dep)}</span>
        {dep.status !== "completed" && (
          <button
            type="button"
            onClick={() => refreshDeployment(dep).then(onRefresh).catch(() => {})}
            className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
            title="Refresh status"
          >
            ⟳
          </button>
        )}
        <a
          href={dep.url}
          target="_blank"
          rel="noreferrer"
          className="text-slate-400 hover:text-slate-200"
          title="Open on GitHub"
        >
          ↗
        </a>
      </div>
    </li>
  );
}

export function DeploymentList({ deployments, onRefresh }: { deployments: Array<Deployment>; onRefresh: (d: Deployment) => void }) {
  if (deployments.length === 0) {
    return <p className="py-2 text-sm text-slate-500">No deployments yet. Trigger one below.</p>;
  }
  return (
    <div>
      <div className="mb-1 border-b border-slate-800 pb-1">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Deployments</span>
      </div>
      <ul>
        {deployments.map((d) => (
          <DeploymentRow key={d.id} dep={d} onRefresh={onRefresh} />
        ))}
      </ul>
    </div>
  );
}

type TriggerFormProps = {
  owner: string;
  repo: string;
  workflows: Array<WorkflowMeta>;
  busy: boolean;
  onSubmit: (workflowId: number, workflowName: string, ref: string, inputs: Record<string, string>) => Promise<void>;
  onCancel: () => void;
};

function TriggerForm({ owner, repo, workflows, busy, onSubmit, onCancel }: TriggerFormProps) {
  const [workflowId, setWorkflowId] = useState<number | "">("");
  const [ref, setRef] = useState("");
  const [inputsText, setInputsText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const selected = workflows.find((w) => w.id === workflowId);

  async function submit() {
    setError(null);
    if (!workflowId) return setError("Pick a workflow to dispatch.");
    if (!ref.trim()) return setError("Enter the branch/ref to dispatch on.");
    const inputs: Record<string, string> = {};
    for (const line of inputsText.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) return setError(`Input line must be key=value: "${trimmed}"`);
      inputs[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    try {
      await onSubmit(workflowId as number, selected?.name || String(workflowId), ref.trim(), inputs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dispatch failed");
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
        Trigger deployment · {owner}/{repo}
      </div>
      <label className="block text-xs text-slate-400">
        Workflow
        <select
          value={workflowId}
          onChange={(e) => setWorkflowId(e.target.value ? Number(e.target.value) : "")}
          className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">Select a workflow…</option>
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.path})
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-slate-400">
        Branch / ref
        <input
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder="e.g. main"
          className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:ring-1 focus:ring-blue-500"
        />
      </label>
      <label className="block text-xs text-slate-400">
        Inputs <span className="text-slate-600">(optional, one key=value per line)</span>
        <textarea
          value={inputsText}
          onChange={(e) => setInputsText(e.target.value)}
          rows={2}
          placeholder={"environment=production"}
          className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:ring-1 focus:ring-blue-500"
        />
      </label>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
        >
          {busy ? "Dispatching…" : "Dispatch"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

type DeploymentsProps = {
  owner: string;
  repo: string;
  project: string | null;
};

// The main module: shows cached deployments for the scope + a trigger form.
// Self-contained; both shells mount it via the shared App (P6).
export function Deployments({ owner, repo, project }: DeploymentsProps) {
  const deployments = useGitHubStore((s) => s.deployments);
  const listDispatchableWorkflows = useGitHubStore((s) => s.listDispatchableWorkflows);
  const dispatchDeployment = useGitHubStore((s) => s.dispatchDeployment);
  const refreshDeployment = useGitHubStore((s) => s.refreshDeployment);
  // The base Hermes API key the app was provisioned with — the same Bearer key
  // used for every other /api request. Required to authorize the Vercel-key PUT.
  const baseApiKey = useChatStore((s) => s.apiKey);

  // Whole-app project scoping (P9): when a project is active, scope the trigger
  // to that project's ATTACHED repo rather than a hardcoded default. Global
  // scope keeps the passed owner/repo (today's default).
  const repos = useReposStore((s) => s.repos);
  const loadRepos = useReposStore((s) => s.loadRepos);
  const scopeRepo = useMemo(
    () => (project ? repos.find((r) => r.project === project) : undefined),
    [repos, project]
  );
  useEffect(() => {
    if (project) void loadRepos(project);
    // biome-ignore lint/correctness/useExhaustiveDependencies: load once per scope change
  }, [project, loadRepos]);

  const effOwner = scopeRepo?.owner ?? owner;
  const effRepo = scopeRepo?.name ?? repo;

  const [workflows, setWorkflows] = useState<Array<WorkflowMeta>>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [workflowsError, setWorkflowsError] = useState<string | null>(null);

  // Vercel API-key gate (this task). Deployments must not start until a default
  // key is stored server-side; if it isn't, show the key prompt and continue the
  // pending dispatch after a successful save. The GET/PUT live on the same
  // origin as the app (serve.mjs + Vite dev), so no gateway auth is needed.
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [showKeyPrompt, setShowKeyPrompt] = useState(false);
  const [keyUpdating, setKeyUpdating] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [pendingDispatch, setPendingDispatch] = useState<{
    workflowId: number;
    workflowName: string;
    ref: string;
    inputs: Record<string, string>;
  } | null>(null);

  const refresh = useCallback(
    (d: Deployment) => {
      // no-op — store already updated via loadDeployments inside refreshDeployment
      void d;
    },
    []
  );

  // Load cached deployments for the scope + available workflows on mount/scope change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await useGitHubStore.getState().loadDeployments(project);
      } catch {
        /* offline cache read is best-effort */
      }
      if (cancelled) return;
      try {
        const ws = await listDispatchableWorkflows(effOwner, effRepo);
        if (!cancelled) {
          setWorkflows(ws);
          setWorkflowsError(null);
        }
      } catch (err) {
        if (!cancelled) setWorkflowsError(err instanceof Error ? err.message : "Could not load workflows");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effOwner, effRepo, project, listDispatchableWorkflows]);

  // Best-effort read of whether a default Vercel API key is already stored, so
  // the trigger area can show an "update key" affordance and skip the prompt
  // when one exists. A failed read is treated as "not configured" — the gate
  // re-checks fresh at dispatch time regardless, so this is purely cosmetic.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let configured = false;
      try {
        configured = await getVercelKeyConfigured();
      } catch {
        configured = false;
      }
      if (!cancelled) {
        setKeyConfigured(configured);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-poll running deployments while any are in_progress (light cadence).
  const running = useMemo(() => deployments.filter((d) => d.status !== "completed"), [deployments]);
  useEffect(() => {
    if (running.length === 0) return;
    const timer = setTimeout(async () => {
      for (const dep of running) {
        try {
          await refreshDeployment(dep);
        } catch {
          /* transient poll failure — try again next tick */
        }
      }
    }, DEPLOYMENT_POLL_MS);
    return () => clearTimeout(timer);
  }, [running, refreshDeployment]);

  // The actual dispatch (runs once the key gate passes).
  async function doDispatch(workflowId: number, workflowName: string, ref: string, inputs: Record<string, string>) {
    setBusy(true);
    try {
      await dispatchDeployment({ owner: effOwner, repo: effRepo, workflowId, workflowName, ref, inputs, project });
      setShowForm(false);
    } finally {
      setBusy(false);
    }
  }

  // Gate: deployments must not start without a stored default Vercel API key.
  // Always re-verify configuration FRESH at dispatch time — never trust the
  // mount-time `keyConfigured` snapshot (VAL-F11). The key could have been
  // cleared or rotated between mount and this click, and the stale value would
  // otherwise let a dispatch fire against a key that no longer exists.
  async function handleDispatch(workflowId: number, workflowName: string, ref: string, inputs: Record<string, string>) {
    if (keyBusy) return; // avoid duplicate submissions while a save is in flight
    let configured: boolean;
    try {
      configured = await getVercelKeyConfigured();
    } catch {
      configured = false;
    }
    setKeyConfigured(configured);
    if (!configured) {
      // Stash the dispatch so it continues after the key is saved.
      setPendingDispatch({ workflowId, workflowName, ref, inputs });
      setKeyUpdating(false);
      setKeyError(null);
      setShowKeyPrompt(true);
      return;
    }
    await doDispatch(workflowId, workflowName, ref, inputs);
  }

  async function handleSaveKey(apiKey: string) {
    if (keyBusy) return;
    setKeyBusy(true);
    setKeyError(null);
    const pending = pendingDispatch;
    setPendingDispatch(null);

    // Domain 1: save the key. A save failure keeps the prompt open with a
    // key-save error so the user can retry pasting the key.
    try {
      await saveVercelApiKey(apiKey, baseApiKey);
      setKeyConfigured(true);
      setKeyChecked(true);
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : "Could not save Vercel API key");
      setKeyBusy(false);
      return;
    }

    // Domain 2: if a dispatch was gated on the (now-saved) key, continue it.
    // A dispatch failure is a dispatch error — the key WAS saved, so it must
    // never surface as a save error.
    setShowKeyPrompt(false);
    if (pending) {
      try {
        await doDispatch(pending.workflowId, pending.workflowName, pending.ref, pending.inputs);
      } catch (err) {
        setDispatchError(err instanceof Error ? err.message : "Dispatch failed");
        setShowForm(true);
      } finally {
        setKeyBusy(false);
      }
      return;
    }
    setKeyBusy(false);
  }

  function handleCancelKey() {
    setShowKeyPrompt(false);
    setPendingDispatch(null);
    setKeyError(null);
    setDispatchError(null);
  }

  function openKeyUpdate() {
    setPendingDispatch(null);
    setKeyUpdating(keyConfigured); // add/required mode for first-time, update mode when a key exists
    setKeyError(null);
    setDispatchError(null);
    setShowKeyPrompt(true);
  }

  const hasConnection = useGitHubStore((s) => s.connections.length > 0);

  if (!hasConnection) {
    return <p className="py-2 text-sm text-slate-500">Connect GitHub in Settings to trigger deployments.</p>;
  }

  return (
    <div className="space-y-3">
      <GitRepoNotice />
      {project && !scopeRepo ? (
        <p className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
          No repository is attached to this project. Attach one in the Repos module to trigger deployments for it.
        </p>
      ) : showKeyPrompt ? (
        <VercelKeyPrompt
          updating={keyUpdating}
          busy={keyBusy}
          error={keyError}
          onSave={handleSaveKey}
          onCancel={handleCancelKey}
        />
      ) : showForm ? (
        <div className="space-y-2">
          {dispatchError && (
            <p role="alert" className="text-xs text-red-400">
              {dispatchError}
            </p>
          )}
          <TriggerForm
            owner={effOwner}
            repo={effRepo}
            workflows={workflows}
            busy={busy}
            onSubmit={handleDispatch}
            onCancel={() => {
              setDispatchError(null);
              setShowForm(false);
            }}
          />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setDispatchError(null);
              setShowForm(true);
            }}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 transition-colors"
          >
            + Trigger deployment
          </button>
          <button
            type="button"
            onClick={openKeyUpdate}
            className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
            title="View or update the stored default Vercel API key used for deployments"
          >
            {keyConfigured ? "Vercel API key · change" : "Set Vercel API key"}
          </button>
        </div>
      )}

      {workflowsError && <p className="text-xs text-amber-400">Workflows unavailable: {workflowsError}</p>}

      <DeploymentList deployments={deployments} onRefresh={refresh} />
    </div>
  );
}
