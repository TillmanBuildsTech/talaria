// Kanban client (M1 Command Center) — reads the REAL Hermes kanban board via
// the serve.mjs bridge (/kanban-api), never a forked copy. The bridge resolves
// the board by project slug (default board for the global/unassigned scope).
// Columns map the dispatcher lifecycle (agent-orchestration.md §"Kanban states
// & hygiene"). Every write shells the `hermes kanban` CLI server-side so the
// app and the dispatcher share one code path.
import { useProjectsStore } from "../stores/projects";
import { hermesClient } from "./hermes";

export type KanbanStatus =
  | "triage"
  | "todo"
  | "scheduled"
  | "ready"
  | "running"
  | "blocked"
  | "review"
  | "done"
  | "archived";

// The Command Center columns (agent-orchestration.md): triage + todo/scheduled
// surface under "Ready", running = "In progress", review/done/blocked verbatim.
// scheduled is a time-based waiting state — grouped into Ready.
export const KANBAN_COLUMNS: ReadonlyArray<{ key: KanbanStatus; label: string }> = [
  { key: "triage", label: "Triage" },
  { key: "todo", label: "Ready" },
  { key: "running", label: "In progress" },
  { key: "review", label: "Review" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
];

// Map a raw board status onto a Command Center column key.
export function columnForStatus(status: KanbanStatus): KanbanStatus {
  if (status === "scheduled" || status === "ready") return "todo";
  return status === "archived" ? "done" : status;
}

export type KanbanCard = {
  id: string;
  title: string;
  status: KanbanStatus;
  priority: number;
  assignee: string | null;
  created_by: string | null;
  created_at: number | null;
  started_at: number | null;
  completed_at: number | null;
  body: string | null;
  branch_name: string | null;
  workspace_kind: string | null;
  workspace_path: string | null;
  model_override: string | null;
  project_id: string | null;
  block_kind: string | null;
  link_counts?: { parents: number; children: number };
  comment_count?: number;
  latest_summary?: string | null;
};

export type KanbanComment = {
  id: number;
  author: string;
  body: string;
  created_at: number;
};

export type KanbanRun = {
  id: number;
  profile: string | null;
  status: string | null;
  outcome: string | null;
  summary: string | null;
  metadata: string | null;
  error: string | null;
  started_at: number | null;
  ended_at: number | null;
  worker_pid: number | null;
};

export type KanbanAttachment = {
  id: number;
  filename: string;
  content_type: string | null;
  size: number;
  uploaded_by: string | null;
  created_at: number;
  stored_path: string | null;
};

export type KanbanBoard = {
  board: string;
  columns: Record<string, Array<KanbanCard>>;
  exists: boolean;
};

export type KanbanTaskDetail = {
  task: KanbanCard;
  parents: Array<string>;
  children: Array<string>;
  comments: Array<KanbanComment>;
  runs: Array<KanbanRun>;
  attachments: Array<KanbanAttachment>;
};

export type AutonomyMode = "swarm" | "supervised" | "manual";

// Board slug for the active project scope: the project's slug (which matches
// the Hermes board slug), or "" for the global/unassigned scope → default board.
export function activeBoardSlug(): string {
  const p = useProjectsStore.getState().activeProject();
  return p?.slug ?? "";
}

// Kanban API root. Derive it from the same configured server origin as chat
// (hermesClient.gatewayRoot) so the board FOLLOWS the URL set in settings —
// never a hardcoded same-origin path. Same-origin (PWA via serve.mjs, default
// baseUrl /api/v1) resolves to "" → fetches stay relative /kanban-api/*;
// cross-origin (Tauri desktop pointed at hermes.tillmanbuildstech.com) resolves
// to the absolute https://host so the desktop can actually reach the bridge.
export function kanbanApiBase(): string {
  return hermesClient.gatewayRoot();
}

export function boardUrl(path: string, board?: string): string {
  const slug = board ?? activeBoardSlug();
  const q = slug ? `?board=${encodeURIComponent(slug)}` : "";
  return `${kanbanApiBase()}${path}${q}`;
}

// Bearer key shared with the Hermes gateway; the serve.mjs bridge validates it
// the same way. Only sent when a key is configured (never a bare header).
function authHeaders(): Record<string, string> {
  const key = hermesClient.apiKey;
  return key ? { Authorization: `Bearer ${key}` } : {};
}

class KanbanClient {
  async fetchBoard(board?: string): Promise<KanbanBoard> {
    const r = await fetch(boardUrl("/kanban-api/board", board), {
      headers: { Accept: "application/json", ...authHeaders() },
    });
    if (!r.ok) throw new Error(`kanban board HTTP ${r.status}`);
    return r.json();
  }

  async fetchTask(taskId: string, board?: string): Promise<KanbanTaskDetail> {
    const r = await fetch(boardUrl(`/kanban-api/tasks/${encodeURIComponent(taskId)}`, board), {
      headers: { Accept: "application/json", ...authHeaders() },
    });
    if (!r.ok) throw new Error(`kanban task HTTP ${r.status}`);
    return r.json();
  }

  async archiveTask(taskId: string, board?: string): Promise<void> {
    const r = await fetch(boardUrl(`/kanban-api/tasks/${encodeURIComponent(taskId)}/archive`, board), {
      method: "POST",
      headers: { ...authHeaders() },
    });
    if (!r.ok) throw new Error(`kanban archive HTTP ${r.status}`);
  }

  async unblockTask(taskId: string, board?: string): Promise<void> {
    const r = await fetch(boardUrl(`/kanban-api/tasks/${encodeURIComponent(taskId)}/unblock`, board), {
      method: "POST",
      headers: { ...authHeaders() },
    });
    if (!r.ok) throw new Error(`kanban unblock HTTP ${r.status}`);
  }
}

export const kanbanClient = new KanbanClient();
