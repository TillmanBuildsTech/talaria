// Observability module (M1) — see everything your agents actually do, live
// and replayable, from one screen.
//
// Mounted from the shared App so both shells (PWA + desktop) get it (P6).
// Reads the projects store for the active project scope (P9) and the
// observability store for the activity feed. Implements the P3 core rule in
// the UI: a "done" claim only renders as verified when it carries a linkable
// artifact (isArtifactBacked); otherwise it shows as an unverified claim.
//
// Tabs:
//   Feed    — global live stream of every agent's actions + tool calls,
//             filterable by agent / task / kind.
//   Agent   — everything one agent has done, in order; drill into any step.
//   Task    — all activity for one kanban task, start → finish, replayable.
//   Artifacts — branches/commits/PRs/CI/deploys an agent produced, linked &
//             verifiable (P3).
// Reviewable events (those carrying a diff) surface an Approve / Request
// changes / Reject gate inline (P2), honoring the human review loop.
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  type ActivityEvent,
  type ActivityKind,
  type Artifact,
  type ReviewVerdict,
} from "../db";
import { useProjectsStore } from "../stores/projects";
import { useObservabilityStore, isArtifactBacked, isReviewable } from "../stores/observability";

type Tab = "feed" | "agent" | "task" | "artifacts";

const KIND_LABEL: Record<ActivityKind, string> = {
  action: "action",
  tool: "tool",
  artifact: "artifact",
  review: "review",
};

const KIND_COLOR: Record<ActivityKind, string> = {
  action: "text-sky-400",
  tool: "text-violet-400",
  artifact: "text-emerald-400",
  review: "text-amber-400",
};

const ARTIFACT_LABEL: Record<Artifact["kind"], string> = {
  branch: "branch",
  commit: "commit",
  pr: "PR",
  ci: "CI",
  deploy: "deploy",
};

const VERDICT_LABEL: Record<ReviewVerdict, string> = {
  approved: "Approved",
  changes: "Changes requested",
  rejected: "Rejected",
};

const VERDICT_COLOR: Record<ReviewVerdict, string> = {
  approved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  changes: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  rejected: "bg-rose-500/15 text-rose-300 border-rose-500/40",
};

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function shortRef(ref?: string): string {
  return ref && ref.length > 8 ? ref.slice(0, 7) : (ref ?? "");
}

function StatusBadge({ ev }: { ev: ActivityEvent }) {
  if (ev.status === "failed") {
    return <span className="text-[10px] uppercase tracking-wider text-rose-400 border border-rose-500/40 rounded-full px-1.5 py-px">failed</span>;
  }
  if (ev.status === "running") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-sky-400 border border-sky-500/40 rounded-full px-1.5 py-px">
        <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
        running
      </span>
    );
  }
  // done — but only verified when artifact-backed (P3).
  if (isArtifactBacked(ev)) {
    return <span className="text-[10px] uppercase tracking-wider text-emerald-400 border border-emerald-500/40 rounded-full px-1.5 py-px">done</span>;
  }
  return (
    <span
      className="text-[10px] uppercase tracking-wider text-slate-500 border border-slate-700 rounded-full px-1.5 py-px"
      title="Agent claims done but no linkable artifact proves it (P3) — not trusted as verified."
    >
      unverified
    </span>
  );
}

function ArtifactChip({ artifact }: { artifact: Artifact }) {
  const inner = (
    <span className="inline-flex items-center gap-1 text-[11px] font-mono text-blue-300 bg-blue-500/10 border border-blue-500/30 rounded-lg px-1.5 py-0.5">
      <span className="uppercase tracking-wider text-[9px] text-blue-400/80">{ARTIFACT_LABEL[artifact.kind]}</span>
      <span className="truncate max-w-[200px]">{shortRef(artifact.ref) || artifact.title}</span>
      <svg className="w-2.5 h-2.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </span>
  );
  if (artifact.url) {
    return (
      <a href={artifact.url} target="_blank" rel="noreferrer" title={`Open ${artifact.title}`}>
        {inner}
      </a>
    );
  }
  return inner;
}

// Render a unified diff in a scrollable <pre>, colorized minimally by line.
function DiffView({ diff }: { diff: string }) {
  const lines = useMemo(() => diff.split("\n"), [diff]);
  return (
    <pre className="text-[11px] leading-relaxed font-mono overflow-x-auto bg-slate-950/70 rounded-lg p-3 border border-slate-800 max-h-80 overflow-y-auto">
      {lines.map((line, i) => {
        let cls = "text-slate-400";
        if (line.startsWith("+") && !line.startsWith("+++")) cls = "text-emerald-300 bg-emerald-500/5";
        else if (line.startsWith("-") && !line.startsWith("---")) cls = "text-rose-300 bg-rose-500/5";
        else if (line.startsWith("@@")) cls = "text-sky-400 font-bold";
        else if (line.startsWith("+++") || line.startsWith("---")) cls = "text-slate-500";
        return (
          <div key={i} className={cls}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

// Reviewable event card: shows the diff + Approve / Request changes / Reject.
function ReviewCard({ ev }: { ev: ActivityEvent }) {
  const review = useObservabilityStore((s) => s.review);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(verdict: ReviewVerdict) {
    if (ev.id == null) return;
    setBusy(true);
    setError(null);
    try {
      await review(ev.id, verdict);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record verdict");
    } finally {
      setBusy(false);
    }
  }

  if (ev.reviewVerdict) {
    return (
      <div className={`mt-2 inline-flex items-center gap-2 text-xs px-2.5 py-1 rounded-lg border ${VERDICT_COLOR[ev.reviewVerdict]}`}>
        {VERDICT_LABEL[ev.reviewVerdict]}
      </div>
    );
  }

  return (
    <div className="mt-2">
      <DiffView diff={ev.diff as string} />
      {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => submit("approved")}
          className="px-2.5 py-1 text-[11px] rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/30 disabled:opacity-50 transition-colors"
        >
          Approve
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => submit("changes")}
          className="px-2.5 py-1 text-[11px] rounded-lg bg-amber-600/20 border border-amber-500/40 text-amber-300 hover:bg-amber-600/30 disabled:opacity-50 transition-colors"
        >
          Request changes
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => submit("rejected")}
          className="px-2.5 py-1 text-[11px] rounded-lg bg-rose-600/20 border border-rose-500/40 text-rose-300 hover:bg-rose-600/30 disabled:opacity-50 transition-colors"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

// One activity row in the feed / timeline.
function ActivityRow({ ev, onSelect }: { ev: ActivityEvent; onSelect?: (ev: ActivityEvent) => void }) {
  const reviewable = isReviewable(ev) && !ev.reviewVerdict;
  return (
    <li className="py-2 px-3 hover:bg-slate-800/30 rounded-xl transition-colors">
      <div className="flex items-start gap-2.5">
        <span className={`text-[11px] font-mono text-slate-600 shrink-0 mt-0.5 w-14`}>{fmtTime(ev.createdAt)}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[11px] uppercase tracking-wider shrink-0 ${KIND_COLOR[ev.kind]}`}>
              {ev.kind === "tool" && ev.tool ? `tool · ${ev.tool}` : KIND_LABEL[ev.kind]}
            </span>
            <span className="text-sm font-medium text-slate-200">{ev.action}</span>
            {ev.status !== "running" && <StatusBadge ev={ev} />}
          </div>
          {ev.summary && <p className="text-xs text-slate-400 mt-0.5">{ev.summary}</p>}
          {ev.artifact && (
            <div className="mt-1.5">
              <ArtifactChip artifact={ev.artifact} />
            </div>
          )}
          {ev.reviewVerdict && (
            <div className={`mt-1.5 inline-flex items-center text-[11px] px-2 py-0.5 rounded-lg border ${VERDICT_COLOR[ev.reviewVerdict]}`}>
              {VERDICT_LABEL[ev.reviewVerdict]}
            </div>
          )}
          {reviewable && (
            <button
              type="button"
              onClick={() => onSelect?.(ev)}
              className="mt-1.5 text-[11px] px-2 py-0.5 rounded-lg bg-blue-600/20 border border-blue-500/40 text-blue-300 hover:bg-blue-600/30 transition-colors"
            >
              Review diff →
            </button>
          )}
        </div>
      </div>
      {ev.output && ev.status === "failed" && (
        <pre className="mt-1.5 ml-[70px] text-[10px] font-mono text-rose-300/80 bg-rose-500/5 rounded-lg p-2 border border-rose-500/20 overflow-x-auto max-h-24">
          {ev.output}
        </pre>
      )}
    </li>
  );
}

// Expanded detail for a selected (reviewable or drill-down) event.
function DetailPanel({ ev, onClose }: { ev: ActivityEvent; onClose: () => void }) {
  return (
    <div className="border-t border-slate-800 mt-2 pt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">detail · {ev.agent}</span>
        <button type="button" onClick={onClose} className="text-xs text-slate-500 hover:text-slate-200">
          close
        </button>
      </div>
      {ev.summary && <p className="text-xs text-slate-300 mb-2">{ev.summary}</p>}
      {isReviewable(ev) && <ReviewCard ev={ev} />}
      {ev.output && (
        <pre className="text-[10px] font-mono text-slate-400 bg-slate-950/70 rounded-lg p-2 border border-slate-800 overflow-x-auto max-h-40">
          {ev.output}
        </pre>
      )}
    </div>
  );
}

export function Observability() {
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const events = useObservabilityStore((s) => s.events);
  const loading = useObservabilityStore((s) => s.loading);
  const error = useObservabilityStore((s) => s.error);
  const agentFilter = useObservabilityStore((s) => s.agentFilter);
  const taskFilter = useObservabilityStore((s) => s.taskFilter);
  const kindFilter = useObservabilityStore((s) => s.kindFilter);
  const load = useObservabilityStore((s) => s.load);
  const setAgentFilter = useObservabilityStore((s) => s.setAgentFilter);
  const setTaskFilter = useObservabilityStore((s) => s.setTaskFilter);
  const setKindFilter = useObservabilityStore((s) => s.setKindFilter);

  const [tab, setTab] = useState<Tab>("feed");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const agents = useObservabilityStore(useShallow((s) => Array.from(new Set(s.events.map((e) => e.agent))).sort()));
  const tasks = useObservabilityStore(useShallow((s) => Array.from(new Set(s.events.map((e) => e.taskId).filter(Boolean) as string[])).sort()));

  // Project scope (P9): load the active project's activity. Global scope (null)
  // shows unassigned activity only, mirroring the chat namespace rule.
  useEffectLoad(activeProjectId, load);

  // Client-side filtering against the loaded scope.
  const scoped = useMemo(() => events, [events, activeProjectId]);

  const filtered = useMemo(() => {
    return scoped.filter((ev) => {
      if (activeProjectId !== undefined && (ev.projectId ?? null) !== (activeProjectId ?? null)) return false;
      if (agentFilter && ev.agent !== agentFilter) return false;
      if (taskFilter && (ev.taskId ?? null) !== taskFilter) return false;
      if (kindFilter && ev.kind !== kindFilter) return false;
      return true;
    });
  }, [scoped, activeProjectId, agentFilter, taskFilter, kindFilter]);

  const projectLabel = useProjectsStore((s) => s.activeProject()?.name) || "Global / Unassigned";

  // Feed tab: newest first.
  const feed = useMemo(() => [...filtered].sort((a, b) => b.createdAt - a.createdAt), [filtered]);

  // Agent timeline: all events for the selected agent, oldest first.
  const agentEvents = useMemo(() => {
    const agent = selectedAgent ?? agentFilter;
    if (!agent) return [];
    return filtered.filter((ev) => ev.agent === agent).sort((a, b) => a.createdAt - b.createdAt);
  }, [filtered, selectedAgent, agentFilter]);

  // Task history: all activity for the selected task, oldest first (replayable).
  const taskEvents = useMemo(() => {
    const task = selectedTask ?? taskFilter;
    if (!task) return [];
    return filtered.filter((ev) => (ev.taskId ?? null) === task).sort((a, b) => a.createdAt - b.createdAt);
  }, [filtered, selectedTask, taskFilter]);

  // Artifacts tab: every event with a linkable artifact, across scope.
  const artifactEvents = useMemo(() => {
    return filtered.filter((ev) => ev.artifact).sort((a, b) => b.createdAt - a.createdAt);
  }, [filtered]);

  const selectedEvent = expanded != null ? scoped.find((e) => e.id === expanded) : null;

  function openEvent(ev: ActivityEvent) {
    setExpanded(ev.id ?? null);
  }

  const tabBtn = (t: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(t)}
      className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${tab === t ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:bg-slate-800"}`}
    >
      {label}
    </button>
  );

  const filterSelect = "px-2 py-1 text-[11px] rounded-lg bg-slate-800 border border-slate-700 text-slate-300";

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-300">Agent Observability</h2>
        <span className="text-[10px] uppercase tracking-wider text-slate-500">scope · {projectLabel}</span>
      </div>

      {error && <p className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2 mb-3">{error}</p>}

      {/* Tabs */}
      <div className="flex gap-1 mb-3">
        {tabBtn("feed", "Live feed")}
        {tabBtn("agent", "Agent timeline")}
        {tabBtn("task", "Task history")}
        {tabBtn("artifacts", "Artifacts")}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <select value={agentFilter ?? ""} onChange={(e) => setAgentFilter(e.target.value || null)} className={filterSelect} aria-label="Filter by agent">
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select value={kindFilter ?? ""} onChange={(e) => setKindFilter((e.target.value || null) as ActivityKind | null)} className={filterSelect} aria-label="Filter by kind">
          <option value="">All kinds</option>
          {(Object.keys(KIND_LABEL) as ActivityKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        {tasks.length > 0 && (
          <select value={taskFilter ?? ""} onChange={(e) => setTaskFilter(e.target.value || null)} className={filterSelect} aria-label="Filter by task">
            <option value="">All tasks</option>
            {tasks.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
        {(agentFilter || kindFilter || taskFilter) && (
          <button
            type="button"
            onClick={() => {
              setAgentFilter(null);
              setKindFilter(null);
              setTaskFilter(null);
              setSelectedAgent(null);
              setSelectedTask(null);
            }}
            className="text-[11px] text-slate-500 hover:text-slate-200 px-1.5"
          >
            clear filters
          </button>
        )}
      </div>

      {loading && !filtered.length && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="w-3.5 h-3.5 border-2 border-slate-600 border-t-transparent rounded-full animate-spin" />
          Loading activity…
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-xs text-slate-500 bg-slate-800/40 rounded-lg px-3 py-4 text-center">
          No agent activity yet{activeProjectId ? " in this project scope" : ""}. Agent actions and tool calls will stream here live.
        </div>
      )}

      {/* ── FEED ─────────────────────────────────────────────── */}
      {tab === "feed" && filtered.length > 0 && (
        <ul className="divide-y divide-slate-800/60 border border-slate-800/60 rounded-xl overflow-hidden bg-slate-900/40">
          {feed.map((ev) => (
            <ActivityRow key={ev.id} ev={ev} onSelect={openEvent} />
          ))}
        </ul>
      )}

      {/* ── AGENT TIMELINE ───────────────────────────────────── */}
      {tab === "agent" && (
        <div>
          <div className="flex gap-1.5 flex-wrap mb-3">
            {agents.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => {
                  setSelectedAgent(a);
                  setAgentFilter(a);
                }}
                className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
                  (selectedAgent ?? agentFilter) === a
                    ? "bg-blue-600/20 border-blue-500/40 text-blue-300"
                    : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
          {agentEvents.length === 0 ? (
            <div className="text-xs text-slate-500 bg-slate-800/40 rounded-lg px-3 py-4 text-center">
              {agents.length ? "Select an agent to see its timeline." : "No agent activity recorded."}
            </div>
          ) : (
            <ol className="space-y-1">
              {agentEvents.map((ev, i) => (
                <li key={ev.id} className="relative pl-5">
                  <span className="absolute left-0 top-2 w-2 h-2 rounded-full bg-slate-600" />
                  {i < agentEvents.length - 1 && <span className="absolute left-[3px] top-4 bottom-0 w-px bg-slate-800" />}
                  <ActivityRow ev={ev} onSelect={openEvent} />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* ── TASK HISTORY ─────────────────────────────────────── */}
      {tab === "task" && (
        <div>
          <div className="flex gap-1.5 flex-wrap mb-3">
            {tasks.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setSelectedTask(t);
                  setTaskFilter(t);
                }}
                className={`px-2.5 py-1 rounded-full text-[11px] font-mono border transition-colors ${
                  (selectedTask ?? taskFilter) === t
                    ? "bg-amber-600/20 border-amber-500/40 text-amber-300"
                    : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          {taskEvents.length === 0 ? (
            <div className="text-xs text-slate-500 bg-slate-800/40 rounded-lg px-3 py-4 text-center">
              {tasks.length ? "Select a task to replay its history." : "No task-scoped activity recorded yet."}
            </div>
          ) : (
            <ol className="space-y-1">
              {taskEvents.map((ev, i) => (
                <li key={ev.id} className="relative pl-5">
                  <span className="absolute left-0 top-2 w-2 h-2 rounded-full bg-amber-500/70" />
                  {i < taskEvents.length - 1 && <span className="absolute left-[3px] top-4 bottom-0 w-px bg-slate-800" />}
                  <ActivityRow ev={ev} onSelect={openEvent} />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* ── ARTIFACTS ────────────────────────────────────────── */}
      {tab === "artifacts" && (
        <div>
          {artifactEvents.length === 0 ? (
            <div className="text-xs text-slate-500 bg-slate-800/40 rounded-lg px-3 py-4 text-center">
              No artifacts produced yet. Branches, commits, PRs, CI runs, and deploys appear here, each linked & verifiable (P3).
            </div>
          ) : (
            <ul className="divide-y divide-slate-800/60 border border-slate-800/60 rounded-xl overflow-hidden bg-slate-900/40">
              {artifactEvents.map((ev) => (
                <li key={ev.id} className="px-3 py-2.5 flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${isArtifactBacked(ev) ? "bg-emerald-400" : "bg-slate-600"}`} title={isArtifactBacked(ev) ? "verifiable" : "unverified"} />
                  <span className="text-[11px] font-mono text-slate-600 shrink-0 w-16">{fmtDate(ev.createdAt)}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-slate-200 truncate">{ev.action}</span>
                    {ev.agent && <span className="block text-[11px] text-slate-500">{ev.agent}{ev.taskId ? ` · ${ev.taskId}` : ""}</span>}
                  </span>
                  {ev.artifact && <ArtifactChip artifact={ev.artifact} />}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Selected event detail (diff review / drill-down) */}
      {selectedEvent && <DetailPanel ev={selectedEvent} onClose={() => setExpanded(null)} />}
    </div>
  );
}

// Load the active project scope's activity whenever it changes (P9). Reuses
// the existing effect pattern used by repo-browser.
function useEffectLoad(projectId: string | null, load: (filter?: { projectId?: string | null }) => Promise<void>) {
  useEffect(() => {
    void load({ projectId });
  }, [projectId, load]);
}
