// Kanban Command Center (M1, roadmap §1) — renders the REAL Hermes kanban
// board scoped to the active project. Columns: Triage / Ready / In-progress /
// Review / Blocked / Done. Task detail shows title, context (body), acceptance
// criteria, priority, specialty (assignee), deps, artifacts. Includes the
// autonomy dial per task and blocked-task hygiene (stale-blocker prompts,
// archive). Live view of dispatcher state via the serve.mjs bridge.
import { useEffect, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { KANBAN_COLUMNS, type KanbanCard, type KanbanStatus } from "../services/kanban";
import { useKanbanStore } from "../stores/kanban";
import { useProjectsStore } from "../stores/projects";
import { AutonomyDial } from "./autonomy-dial";

const PRIORITY_LABEL: Record<number, string> = { 0: "P3", 1: "P2", 2: "P1", 3: "P0" };

const COLUMN_COLORS: Partial<Record<KanbanStatus, string>> = {
  triage: "#64748b",
  todo: "#38bdf8",
  running: "#a78bfa",
  review: "#fbbf24",
  blocked: "#fb7185",
  done: "#34d399",
};

const ASSIGNEE_COLORS: Record<string, string> = {
  developer: "#38bdf8",
  researcher: "#a78bfa",
  operations: "#34d399",
  "product-owner": "#fbbf24",
  "quality-assurance": "#fb7185",
  comedian: "#f472b6",
};

function assigneeColor(name: string | null): string {
  if (!name) return "#64748b";
  return ASSIGNEE_COLORS[name] ?? "#60a5fa";
}

function fmtAge(ms: number | null | undefined): string {
  if (!ms) return "";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function fmtDate(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Extract acceptance criteria lines from a task body (## Acceptance / ## AC /
// "Acceptance criteria:" sections). Returns matched lines or [].
export function acceptanceCriteria(body: string | null): Array<string> {
  if (!body) return [];
  const out: Array<string> = [];
  const lines = body.split("\n");
  let inSection = false;
  for (const line of lines) {
    const t = line.trim();
    if (/^(#+\s*(acceptance|acceptance criteria|ac)\b|acceptance criteria\s*:)/i.test(t)) {
      inSection = true;
      continue;
    }
    if (inSection) {
      if (/^#+\s/.test(t) || (/^[a-z ]+:/.test(t) && !t.startsWith("-") && !t.startsWith("*"))) break;
      if (t.startsWith("-") || t.startsWith("*")) out.push(t.replace(/^[-*]\s*/, "").trim());
      else if (t) out.push(t);
    }
  }
  return out;
}

export function KanbanBoard({ onClose }: { onClose?: () => void }) {
  const activeProject = useProjectsStore(useShallow((s) => s.activeProject()));

  const board = useKanbanStore((s) => s.board);
  const loading = useKanbanStore((s) => s.loading);
  const error = useKanbanStore((s) => s.error);
  const loadBoard = useKanbanStore((s) => s.loadBoard);
  const init = useKanbanStore((s) => s.init);
  const selectTask = useKanbanStore((s) => s.selectTask);
  const selectedTaskId = useKanbanStore((s) => s.selectedTaskId);
  const detail = useKanbanStore((s) => s.detail);
  const detailLoading = useKanbanStore((s) => s.detailLoading);
  const closeDetail = useKanbanStore((s) => s.closeDetail);
  const archiveTask = useKanbanStore((s) => s.archiveTask);
  const unblockTask = useKanbanStore((s) => s.unblockTask);
  const staleBlocked = useKanbanStore(useShallow((s) => s.staleBlocked()));
  const cardsIn = useKanbanStore((s) => s.cardsIn);
  const cardAgeMs = useKanbanStore((s) => s.cardAgeMs);

  // Load on mount + reload when the active project scope changes.
  useEffect(() => {
    init();
    // biome-ignore lint/correctness/useExhaustiveDependencies: init once on mount
  }, []);

  const scopeKey = activeProject?.slug ?? "__global__";
  useEffect(() => {
    loadBoard();
    closeDetail();
    // biome-ignore lint/correctness/useExhaustiveDependencies: reload on scope change
  }, [scopeKey]);

  if (loading && !board) {
    return <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">Loading board…</div>;
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Command Center toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800 bg-slate-900/80 shrink-0">
        <span className="text-xs font-semibold text-slate-200">Command Center</span>
        <span className="text-[10px] text-slate-500">
          {activeProject ? activeProject.name : "Global / unassigned"}
          {board && board.exists ? "" : " · no board yet"}
        </span>
        <span className="ml-auto text-[10px] text-slate-500">live Hermes kanban</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400"
            aria-label="Close command center"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Board area */}
      <div className="flex-1 flex overflow-hidden">
      {/* Board columns */}
      <div className="flex-1 flex gap-3 px-4 py-3 overflow-x-auto">
        {KANBAN_COLUMNS.map((col) => {
          const cards = cardsIn(col.key);
          return (
            <div key={col.key} className="w-72 shrink-0 flex flex-col rounded-xl border border-slate-800 bg-slate-900/60 min-h-0">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800 shrink-0">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLUMN_COLORS[col.key] }} />
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">{col.label}</span>
                <span className="text-[10px] text-slate-500 ml-auto">{cards.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {cards.map((card) => (
                  <KanbanCardView
                    key={card.id}
                    card={card}
                    ageMs={cardAgeMs(card)}
                    selected={card.id === selectedTaskId}
                    onSelect={() => selectTask(card.id)}
                  />
                ))}
                {cards.length === 0 && <div className="px-2 py-4 text-center text-slate-600 text-xs">No tasks</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Stale-blocker hygiene banner */}
      {staleBlocked.length > 0 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 w-[min(560px,90vw)]">
          <div className="rounded-xl border border-red-500/40 bg-red-950/90 p-3 shadow-xl backdrop-blur">
            <div className="text-xs font-semibold text-red-300 mb-2">
              {staleBlocked.length} blocked task{staleBlocked.length > 1 ? "s" : ""} older than 7 days with no comment — a failure state
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {staleBlocked.map((c) => (
                <div key={c.id} className="flex items-center gap-2 text-xs">
                  <button type="button" className="flex-1 text-left text-slate-200 hover:underline truncate" onClick={() => selectTask(c.id)}>
                    {c.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => unblockTask(c.id)}
                    className="px-2 py-0.5 rounded bg-emerald-600/80 hover:bg-emerald-600 text-slate-100"
                  >
                    Unblock
                  </button>
                  <button
                    type="button"
                    onClick={() => archiveTask(c.id)}
                    className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
                  >
                    Archive
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Task detail drawer */}
      {(selectedTaskId || detailLoading) && (
        <div className="w-[400px] max-w-[85vw] shrink-0 border-l border-slate-800 bg-slate-950 flex flex-col">
          <TaskDetail
            detail={detail}
            loading={detailLoading}
            onClose={closeDetail}
            onArchive={archiveTask}
            onUnblock={unblockTask}
          />
        </div>
      )}

      {error && (
        <div className="absolute bottom-3 right-3 z-20 px-3 py-2 rounded-lg bg-red-950 border border-red-500/40 text-xs text-red-300">
          {error}
        </div>
      )}
      </div>
    </div>
  );
}

function KanbanCardView({
  card,
  ageMs,
  selected,
  onSelect,
}: {
  card: KanbanCard;
  ageMs: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
        selected
          ? "border-blue-500 bg-slate-800/80"
          : card.status === "blocked"
            ? "border-red-500/40 bg-red-950/20 hover:bg-slate-800/70"
            : "border-slate-800 bg-slate-800/40 hover:bg-slate-800/70"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className="px-1.5 py-0.5 rounded text-[9px] font-bold text-slate-900 shrink-0"
          style={{ backgroundColor: PRIORITY_LABEL[card.priority] === "P0" ? "#fb7185" : "#334155", color: PRIORITY_LABEL[card.priority] === "P0" ? "#fff" : "#cbd5e1" }}
        >
          {PRIORITY_LABEL[card.priority] ?? "P3"}
        </span>
        {card.assignee && (
          <span className="px-1.5 py-0.5 rounded-full text-[9px] font-medium text-slate-900 shrink-0" style={{ backgroundColor: assigneeColor(card.assignee) }}>
            {card.assignee}
          </span>
        )}
        <span className="text-[9px] text-slate-500 ml-auto shrink-0">{ageMs ? fmtAge(ageMs) : ""}</span>
      </div>
      <div className="text-xs font-medium text-slate-100 leading-snug line-clamp-2">{card.title}</div>
      <div className="flex items-center gap-2 mt-1.5 text-[10px] text-slate-500">
        {(card.link_counts?.children ?? 0) > 0 && <span>{card.link_counts!.children} deps</span>}
        {(card.comment_count ?? 0) > 0 && <span>{card.comment_count} 💬</span>}
        {card.latest_summary && <span className="truncate flex-1">{card.latest_summary}</span>}
      </div>
    </button>
  );
}

function TaskDetail({
  detail,
  loading,
  onClose,
  onArchive,
  onUnblock,
}: {
  detail: ReturnType<typeof useKanbanStore.getState>["detail"];
  loading: boolean;
  onClose: () => void;
  onArchive: (id: string) => Promise<void>;
  onUnblock: (id: string) => Promise<void>;
}) {
  if (loading || !detail) {
    return <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">Loading task…</div>;
  }
  const { task, parents, children, comments, runs, attachments } = detail;
  const ac = acceptanceCriteria(task.body);
  const isBlocked = task.status === "blocked";
  const hasArtifacts = attachments.length > 0 || task.branch_name;

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800 shrink-0">
        <span className="text-[10px] font-mono text-slate-500 truncate flex-1">{task.id}</span>
        <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-800 text-slate-400" aria-label="Close detail">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <h3 className="text-sm font-semibold text-slate-100">{task.title}</h3>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-2 text-[10px]">
          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">{PRIORITY_LABEL[task.priority] ?? "P3"}</span>
          {task.assignee && (
            <span className="px-1.5 py-0.5 rounded-full text-slate-900 font-medium" style={{ backgroundColor: assigneeColor(task.assignee) }}>
              {task.assignee}
            </span>
          )}
          <span className="text-slate-500">created {fmtDate(task.created_at)}</span>
          {task.completed_at && <span className="text-emerald-500">done {fmtDate(task.completed_at)}</span>}
          {task.model_override && <span className="text-slate-400 font-mono">model: {task.model_override}</span>}
        </div>

        {/* Autonomy dial */}
        <div className="flex items-center justify-between gap-2 border border-slate-800 rounded-lg px-3 py-2">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">Autonomy</span>
          <AutonomyDial taskId={task.id} />
        </div>

        {/* Context */}
        {task.body && (
          <div>
            <SectionLabel>Context</SectionLabel>
            <pre className="text-xs text-slate-300 whitespace-pre-wrap font-sans leading-relaxed max-h-56 overflow-y-auto">{task.body}</pre>
          </div>
        )}

        {/* Acceptance criteria */}
        {ac.length > 0 && (
          <div>
            <SectionLabel>Acceptance criteria</SectionLabel>
            <ul className="space-y-1">
              {ac.map((a, i) => (
                <li key={i} className="text-xs text-slate-300 flex gap-2">
                  <span className="text-emerald-500 shrink-0">✓</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Dependencies */}
        {(parents.length > 0 || children.length > 0) && (
          <div>
            <SectionLabel>Dependencies</SectionLabel>
            <div className="text-xs space-y-1">
              {parents.map((p) => (
                <div key={p} className="text-slate-400">blocked by <span className="font-mono text-slate-300">{p}</span></div>
              ))}
              {children.map((c) => (
                <div key={c} className="text-slate-400">parent of <span className="font-mono text-slate-300">{c}</span></div>
              ))}
            </div>
          </div>
        )}

        {/* Artifacts */}
        {hasArtifacts && (
          <div>
            <SectionLabel>Artifacts</SectionLabel>
            <div className="text-xs space-y-1">
              {task.branch_name && <div className="text-slate-300 font-mono">branch: {task.branch_name}</div>}
              {attachments.map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-slate-300">
                  <span>📎 {a.filename}</span>
                  <span className="text-slate-500">({a.size} B)</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Runs */}
        {runs.length > 0 && (
          <div>
            <SectionLabel>Runs</SectionLabel>
            <div className="space-y-1.5">
              {runs.slice().reverse().map((r) => (
                <div key={r.id} className="text-xs border border-slate-800 rounded-lg px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${r.status === "running" ? "bg-blue-400 animate-pulse" : r.status === "done" ? "bg-emerald-400" : r.status === "blocked" ? "bg-red-400" : "bg-slate-500"}`} />
                    <span className="text-slate-300 font-medium">{r.profile || "unknown"}</span>
                    <span className="text-slate-500">{r.outcome || r.status}</span>
                  </div>
                  {r.summary && <div className="mt-1 text-slate-400 line-clamp-3">{r.summary}</div>}
                  {r.error && <div className="mt-1 text-red-400 line-clamp-3">{r.error}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Comments */}
        {comments.length > 0 && (
          <div>
            <SectionLabel>Comments</SectionLabel>
            <div className="space-y-1.5">
              {comments.map((c) => (
                <div key={c.id} className="text-xs border-l-2 border-slate-700 pl-2 py-0.5">
                  <span className="text-slate-400 font-medium">{c.author}</span>{" "}
                  <span className="text-slate-600 text-[10px]">{fmtDate(c.created_at)}</span>
                  <div className="text-slate-300 whitespace-pre-wrap mt-0.5">{c.body}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Blocked hygiene actions */}
        {isBlocked && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onUnblock(task.id)}
              className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-medium text-slate-100"
            >
              Unblock
            </button>
            <button
              type="button"
              onClick={() => onArchive(task.id)}
              className="flex-1 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-medium text-slate-200"
            >
              Archive
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">{children}</div>;
}
