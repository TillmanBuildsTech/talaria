// Observability store (M1) — the live agent activity feed + per-agent and
// per-task timelines.
//
// What it surfaces (spec agent-observability.md):
//   • Live activity — every agent's actions + tool calls, streaming in real
//     time, filterable by project (P9), agent, task, and kind.
//   • History — replayable per agent and per kanban task, oldest → newest.
//   • Artifacts — branches/commits/PRs/CI/deploys, each linked & verifiable
//     back to its source (P3).
//   • Diff review — pending work lands in a reviewable state; Approve /
//     Request changes / Reject records the human gate (P2).
//
// The core rule (P3): no claim of completed work is trusted without a
// linkable artifact. `isArtifactBacked()` is the single gate the UI uses to
// decide whether a "done" status is shown as verified — a bare "done" with no
// artifact renders as unverified, not done.
//
// Persistence: local-first (P5) — events append to the Dexie `activity` table
// (schema v5) so the feed survives reloads and history is replayable offline.
// The in-memory `events` array is the live view; `load()` hydrates it from
// Dexie filtered to the active project/agent/task.
import { create } from "zustand";
import db, {
  type ActivityEvent,
  type Artifact,
  type ActivityKind,
  type ActivityStatus,
  type ReviewVerdict,
} from "../db";

export type ActivityFilter = {
  projectId?: string | null; // undefined = all scopes; null = global only
  agent?: string | null; // undefined = all agents
  taskId?: string | null; // undefined = all tasks
  kind?: ActivityKind | null;
};

// ── P3 gate ──────────────────────────────────────────────────────────────
// A "done" claim is only trusted when the event carries a linkable artifact.
// Pure + unit-tested; the UI must not show a verified done without this.
export function isArtifactBacked(ev: ActivityEvent | undefined | null): boolean {
  if (!ev) return false;
  // Only "done" claims require proof. Running/failed are states, not claims.
  if (ev.status !== "done") return true;
  const a = ev.artifact;
  if (!a) return false;
  // A linkable artifact (url) is verifiable proof; a bare ref without a url is
  // not enough to trust outside the agent's own report.
  return Boolean(a.url);
}

// A reviewable event: one carrying a diff. Only these enter the human gate.
export function isReviewable(ev: ActivityEvent | undefined | null): boolean {
  return !!ev && typeof ev.diff === "string" && ev.diff.length > 0;
}

export type ObservabilityState = {
  // Live feed (newest first). All scopes loaded; components filter client-side
  // for responsiveness, or call load() to page from Dexie.
  events: Array<ActivityEvent>;
  loading: boolean;
  error: string | null;
  // Active filter (project scope comes from the projects store at the UI
  // boundary; agent/task/kind are user selections).
  agentFilter: string | null;
  taskFilter: string | null;
  kindFilter: ActivityKind | null;

  init: () => Promise<void>;
  load: (filter?: ActivityFilter) => Promise<void>;
  record: (input: {
    agent: string;
    projectId?: string | null;
    taskId?: string | null;
    kind: ActivityKind;
    action: string;
    tool?: string;
    summary?: string;
    output?: string;
    diff?: string | null;
    status?: ActivityStatus;
    artifact?: Artifact | null;
    streamId?: string;
  }) => Promise<ActivityEvent>;
  // Update an in-flight event (e.g. tool call → done with artifact attached).
  update: (id: number, patch: Partial<Omit<ActivityEvent, "id">>) => Promise<void>;
  // Human gate (P2): record a verdict on a reviewable event.
  review: (id: number, verdict: ReviewVerdict) => Promise<void>;
  clear: (projectId?: string | null) => Promise<void>;
  setAgentFilter: (agent: string | null) => void;
  setTaskFilter: (taskId: string | null) => void;
  setKindFilter: (kind: ActivityKind | null) => void;
  reset: () => void;
};

export const useObservabilityStore = create<ObservabilityState>((set, get) => ({
  events: [],
  loading: false,
  error: null,
  agentFilter: null,
  taskFilter: null,
  kindFilter: null,

  async init() {
    await get().load();
  },

  async load(filter: ActivityFilter = {}) {
    set({ loading: true, error: null });
    try {
      let coll = db.activity.toCollection();
      const { agent, taskId, kind } = filter;
      const { agentFilter, taskFilter, kindFilter } = get();
      const a = agent ?? agentFilter;
      const t = taskId ?? taskFilter;
      const k = kind ?? kindFilter;
      if (a) coll = coll.and((ev) => ev.agent === a);
      if (t) coll = coll.and((ev) => (ev.taskId ?? null) === t);
      if (k) coll = coll.and((ev) => ev.kind === k);
      if ("projectId" in filter && filter.projectId !== undefined) {
        coll = coll.and((ev) => (ev.projectId ?? null) === (filter.projectId ?? null));
      }
      const rows = await coll.toArray();
      rows.sort((x, y) => (y.createdAt ?? 0) - (x.createdAt ?? 0));
      set({ events: rows, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : "Could not load activity" });
    }
  },

  async record(input) {
    const ev: ActivityEvent = {
      agent: input.agent,
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      kind: input.kind,
      action: input.action,
      tool: input.tool,
      summary: input.summary,
      output: input.output,
      diff: input.diff ?? null,
      status: input.status ?? "done",
      artifact: input.artifact ?? null,
      streamId: input.streamId,
      createdAt: Date.now(),
    };
    const id = await db.activity.add(ev);
    ev.id = id;
    // Live-append to the in-memory feed (newest first) without a full reload.
    set({ events: [ev, ...get().events] });
    return ev;
  },

  async update(id, patch) {
    await db.activity.update(id, patch);
    set({
      events: get().events.map((ev) => (ev.id === id ? { ...ev, ...patch } : ev)),
    });
  },

  async review(id, verdict) {
    await get().update(id, { reviewVerdict: verdict, status: "done" });
  },

  async clear(projectId) {
    if (projectId !== undefined) {
      const coll = db.activity.filter((ev) => (ev.projectId ?? null) === (projectId ?? null));
      await coll.delete();
      set({ events: get().events.filter((ev) => (ev.projectId ?? null) !== (projectId ?? null)) });
    } else {
      await db.activity.clear();
      set({ events: [] });
    }
  },

  setAgentFilter: (agent) => set({ agentFilter: agent }),
  setTaskFilter: (taskId) => set({ taskFilter: taskId }),
  setKindFilter: (kind) => set({ kindFilter: kind }),

  reset() {
    set({ events: [], loading: false, error: null, agentFilter: null, taskFilter: null, kindFilter: null });
  },
}));
