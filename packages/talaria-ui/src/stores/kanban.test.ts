import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "../db";
import { columnForStatus, KANBAN_COLUMNS } from "../services/kanban";
import { kanbanClient } from "../services/kanban";
import { STALE_BLOCKED_MS, useKanbanStore } from "./kanban";
import { useProjectsStore } from "./projects";

// The store talks to the serve.mjs bridge; stub the client so tests assert the
// store's scoping/derivation logic without a live board.
vi.mock("../services/kanban", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/kanban")>();
  return {
    ...actual,
    kanbanClient: {
      fetchBoard: vi.fn(),
      fetchTask: vi.fn(),
      archiveTask: vi.fn(),
      unblockTask: vi.fn(),
    },
  };
});

const board = {
  board: "talaria",
  exists: true,
  columns: {
    triage: [{ id: "t1", title: "triage task", status: "triage", priority: 1, created_at: Date.now(), assignee: "developer" }],
    todo: [
      { id: "t2", title: "ready task", status: "todo", priority: 2, created_at: Date.now(), assignee: "qa" },
      { id: "t3", title: "scheduled task", status: "scheduled", priority: 0, created_at: Date.now(), assignee: "ops" },
    ],
    ready: [{ id: "t4", title: "ready-status task", status: "ready", priority: 3, created_at: Date.now(), assignee: "dev" }],
    running: [{ id: "t5", title: "running task", status: "running", priority: 2, created_at: Date.now(), assignee: "developer" }],
    review: [{ id: "t6", title: "review task", status: "review", priority: 1, created_at: Date.now(), assignee: "qa" }],
    blocked: [
      { id: "t7", title: "fresh blocked", status: "blocked", priority: 1, created_at: Date.now(), assignee: "dev", comment_count: 1 },
      { id: "t8", title: "stale blocked", status: "blocked", priority: 1, created_at: Date.now() - STALE_BLOCKED_MS - 1000, assignee: "dev", comment_count: 0 },
    ],
    done: [{ id: "t9", title: "done task", status: "done", priority: 1, created_at: Date.now(), assignee: "dev" }],
    scheduled: [],
  },
};

function card(id: string) {
  return Object.values(board.columns)
    .flat()
    .find((c: any) => c.id === id) as any;
}

beforeEach(async () => {
  useProjectsStore.setState({ projects: [], activeProjectId: null, loaded: false });
  useKanbanStore.setState({ board: null, loading: false, error: null, selectedTaskId: null, detail: null, detailLoading: false, autonomy: {} });
  await db.settings.clear();
  vi.clearAllMocks();
});

describe("columnForStatus / KANBAN_COLUMNS", () => {
  it("exposes the Command Center columns Triage/Ready/In-progress/Review/Blocked/Done", () => {
    expect(KANBAN_COLUMNS.map((c) => c.label)).toEqual(["Triage", "Ready", "In progress", "Review", "Blocked", "Done"]);
  });

  it("collapses scheduled+ready into Ready, keeps others verbatim", () => {
    expect(columnForStatus("scheduled")).toBe("todo");
    expect(columnForStatus("ready")).toBe("todo");
    expect(columnForStatus("running")).toBe("running");
    expect(columnForStatus("blocked")).toBe("blocked");
    expect(columnForStatus("done")).toBe("done");
  });
});

describe("kanban store", () => {
  it("loads a board and groups cards into Command Center columns", async () => {
    (kanbanClient.fetchBoard as any).mockResolvedValue(board);
    await useKanbanStore.getState().init();
    expect(useKanbanStore.getState().board?.exists).toBe(true);

    // Ready (todo) includes todo + scheduled + ready-status cards.
    expect(useKanbanStore.getState().cardsIn("todo").map((c) => c.id).sort()).toEqual(["t2", "t3", "t4"]);
    expect(useKanbanStore.getState().cardsIn("running").map((c) => c.id)).toEqual(["t5"]);
    expect(useKanbanStore.getState().cardsIn("review").map((c) => c.id)).toEqual(["t6"]);
    expect(useKanbanStore.getState().cardsIn("done").map((c) => c.id)).toEqual(["t9"]);
  });

  it("sorts Ready cards by priority descending", async () => {
    (kanbanClient.fetchBoard as any).mockResolvedValue(board);
    await useKanbanStore.getState().loadBoard();
    const ids = useKanbanStore.getState().cardsIn("todo").map((c) => c.id);
    // t4 (priority 3) first, then t2 (2), then t3 (0).
    expect(ids).toEqual(["t4", "t2", "t3"]);
  });

  it("detects stale blocked tasks (>7d, no comment)", async () => {
    (kanbanClient.fetchBoard as any).mockResolvedValue(board);
    await useKanbanStore.getState().loadBoard();
    const stale = useKanbanStore.getState().staleBlocked();
    expect(stale.map((c) => c.id)).toEqual(["t8"]);
    // fresh blocked with a comment is not stale
    expect(stale.some((c) => c.id === "t7")).toBe(false);
  });

  it("defaults autonomy to swarm and persists a per-task dial", async () => {
    expect(useKanbanStore.getState().autonomyFor("t5")).toBe("swarm");
    await useKanbanStore.getState().setAutonomy("t5", "manual");
    expect(useKanbanStore.getState().autonomyFor("t5")).toBe("manual");
    const saved = await db.settings.get("kanban:autonomy:t5");
    expect(saved?.value).toBe("manual");
    // A fresh init restores the persisted dial.
    await useKanbanStore.getState().init();
    expect(useKanbanStore.getState().autonomyFor("t5")).toBe("manual");
  });

  it("selects a task and loads its detail", async () => {
    (kanbanClient.fetchTask as any).mockResolvedValue({ task: card("t5"), parents: ["p"], children: [], comments: [], runs: [], attachments: [] });
    await useKanbanStore.getState().selectTask("t5");
    expect(useKanbanStore.getState().selectedTaskId).toBe("t5");
    expect(useKanbanStore.getState().detail?.task.id).toBe("t5");
    expect(useKanbanStore.getState().detail?.parents).toEqual(["p"]);
  });

  it("archiveTask calls the bridge and reloads the board", async () => {
    (kanbanClient.fetchBoard as any).mockResolvedValue(board);
    await useKanbanStore.getState().loadBoard();
    await useKanbanStore.getState().archiveTask("t9");
    expect(kanbanClient.archiveTask).toHaveBeenCalledWith("t9", "");
    expect(kanbanClient.fetchBoard).toHaveBeenCalledTimes(2);
  });

  it("unblockTask calls the bridge and reloads the board", async () => {
    (kanbanClient.fetchBoard as any).mockResolvedValue(board);
    await useKanbanStore.getState().loadBoard();
    await useKanbanStore.getState().unblockTask("t8");
    expect(kanbanClient.unblockTask).toHaveBeenCalledWith("t8", "");
    expect(kanbanClient.fetchBoard).toHaveBeenCalledTimes(2);
  });
});
