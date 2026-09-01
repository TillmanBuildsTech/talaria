// Kanban store (M1 Command Center) — renders the REAL Hermes kanban board
// scoped to the active project (P9). Reads go through the serve.mjs bridge
// (/kanban-api → the actual per-project board SQLite), so the UI is a live
// view of dispatcher state, never a forked board.
//
// Autonomy dial (P2): per-task Swarm / Supervised / Manual. This is a UI
// preference that changes ONLY how a task is created/dispatched — it never
// weakens the safety rails (verification, gates, blocked hygiene). Persisted
// locally keyed by task id (the Hermes board has no autonomy field).
//
// Blocked hygiene (agent-orchestration.md): a blocked task older than 7 days
// without a comment is a failure state — the UI surfaces a stale-blocker
// prompt offering unblock / re-scope / archive (kill-zombie).
import { create } from "zustand";
import db from "../db";
import {
  columnForStatus,
  KanbanAuthError,
  kanbanClient,
  type AutonomyMode,
  type KanbanBoard,
  type KanbanCard,
  type KanbanStatus,
  type KanbanTaskDetail,
} from "../services/kanban";
import { useProjectsStore } from "./projects";

// 7 days — a blocked task this old with no comment is a failure state.
export const STALE_BLOCKED_MS = 7 * 24 * 60 * 60 * 1000;

const autonomyKey = (taskId: string) => `kanban:autonomy:${taskId}`;
const DEFAULT_AUTONOMY: AutonomyMode = "swarm";

export type KanbanState = {
  // Active board state (project-scoped).
  board: KanbanBoard | null;
  loading: boolean;
  error: string | null;
  // True when the last board/task request was rejected for authentication
  // (HTTP 401) — the bridge is key-gated, so a missing/wrong app key is the
  // usual cause. The UI turns this into a "set your API key" prompt.
  authRequired: boolean;

  // Selected task detail.
  selectedTaskId: string | null;
  detail: KanbanTaskDetail | null;
  detailLoading: boolean;

  // Autonomy dial per task (local-only, affects create/dispatch only).
  autonomy: Record<string, AutonomyMode>;

  init: () => Promise<void>;
  loadBoard: () => Promise<void>;
  selectTask: (taskId: string | null) => Promise<void>;
  closeDetail: () => void;
  setAutonomy: (taskId: string, mode: AutonomyMode) => Promise<void>;
  autonomyFor: (taskId: string) => AutonomyMode;
  archiveTask: (taskId: string) => Promise<void>;
  unblockTask: (taskId: string) => Promise<void>;

  // Derived / helpers.
  cardsIn: (status: KanbanStatus) => Array<KanbanCard>;
  // A blocked task older than STALE_BLOCKED_MS with no comment is stale.
  staleBlocked: () => Array<KanbanCard>;
  cardAgeMs: (card: KanbanCard) => number;
};

// Map a raw board status column into a Command Center column key, then filter
// that column's cards (scheduled/ready collapse into Ready; archived hidden).
// Archived cards are filtered here in the store (defense in depth — the bridge
// SQL also excludes them) so the Done column never shows archived work.
function columnCards(board: KanbanBoard, status: KanbanStatus): Array<KanbanCard> {
  const out: Array<KanbanCard> = [];
  for (const [raw, cards] of Object.entries(board.columns)) {
    if (raw === "archived") continue;
    if (columnForStatus(raw as KanbanStatus) !== status) continue;
    for (const c of cards) {
      if (c.status === "archived") continue;
      out.push(c);
    }
  }
  return out;
}

export const useKanbanStore = create<KanbanState>((set, get) => ({
  board: null,
  loading: false,
  error: null,
  authRequired: false,
  selectedTaskId: null,
  detail: null,
  detailLoading: false,
  autonomy: {},

  async init() {
    // Load persisted autonomy dials (map is small; read all kanban:autonomy:*).
    const settings = await db.settings.where("key").startsWith("kanban:autonomy:").toArray();
    const autonomy: Record<string, AutonomyMode> = {};
    for (const s of settings) {
      const id = s.key.slice("kanban:autonomy:".length);
      const v = s.value as AutonomyMode;
      if (v === "swarm" || v === "supervised" || v === "manual") autonomy[id] = v;
    }
    set({ autonomy });
    await get().loadBoard();
  },

  async loadBoard() {
    // Read the active scope at call time so switching projects re-queries the
    // correct board. Global/unassigned → default board.
    const scope = useProjectsStore.getState().scopeForCreate();
    const slug = scope ? useProjectsStore.getState().projects.find((p) => p.id === scope)?.slug : "";
    set({ loading: true, error: null, authRequired: false });
    try {
      const board = await kanbanClient.fetchBoard(slug);
      set({ board, loading: false });
    } catch (err) {
      const isAuth = err instanceof KanbanAuthError;
      set({ loading: false, error: err instanceof Error ? err.message : String(err), authRequired: isAuth });
    }
  },

  async selectTask(taskId) {
    if (!taskId) {
      set({ selectedTaskId: null, detail: null });
      return;
    }
    set({ selectedTaskId: taskId, detailLoading: true });
    const scope = useProjectsStore.getState().scopeForCreate();
    const slug = scope ? useProjectsStore.getState().projects.find((p) => p.id === scope)?.slug : "";
    try {
      const detail = await kanbanClient.fetchTask(taskId, slug);
      set({ detail, detailLoading: false, authRequired: false });
    } catch (err) {
      const isAuth = err instanceof KanbanAuthError;
      set({ detailLoading: false, error: err instanceof Error ? err.message : String(err), authRequired: isAuth });
    }
  },

  closeDetail() {
    set({ selectedTaskId: null, detail: null });
  },

  async setAutonomy(taskId, mode) {
    set({ autonomy: { ...get().autonomy, [taskId]: mode } });
    await db.settings.put({ key: autonomyKey(taskId), value: mode });
  },

  autonomyFor(taskId) {
    return get().autonomy[taskId] ?? DEFAULT_AUTONOMY;
  },

  async archiveTask(taskId) {
    const scope = useProjectsStore.getState().scopeForCreate();
    const slug = scope ? useProjectsStore.getState().projects.find((p) => p.id === scope)?.slug : "";
    await kanbanClient.archiveTask(taskId, slug);
    await get().loadBoard();
    if (get().selectedTaskId === taskId) get().closeDetail();
  },

  async unblockTask(taskId) {
    const scope = useProjectsStore.getState().scopeForCreate();
    const slug = scope ? useProjectsStore.getState().projects.find((p) => p.id === scope)?.slug : "";
    await kanbanClient.unblockTask(taskId, slug);
    await get().loadBoard();
  },

  cardsIn(status) {
    const { board } = get();
    if (!board) return [];
    return columnCards(board, status).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  },

  staleBlocked() {
    return get()
      .cardsIn("blocked")
      .filter((c) => (c.comment_count ?? 0) === 0 && get().cardAgeMs(c) >= STALE_BLOCKED_MS);
  },

  cardAgeMs(card) {
    const base = card.started_at ?? card.created_at;
    return base ? Date.now() - base : 0;
  },
}));
