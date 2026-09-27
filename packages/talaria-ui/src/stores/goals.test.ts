import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "../db";
import { kanbanClient } from "../services/kanban";
import { useGoalsStore } from "./goals";
import { useProjectsStore } from "./projects";

// The store creates the real card through the serve.mjs bridge; stub the client
// so the tests assert the store's contract (what it sends, what it persists)
// without a live board.
vi.mock("../services/kanban", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/kanban")>();
  return {
    ...actual,
    kanbanClient: {
      fetchBoard: vi.fn(),
      fetchTask: vi.fn(),
      archiveTask: vi.fn(),
      unblockTask: vi.fn(),
      createTask: vi.fn(),
    },
  };
});

const createTask = kanbanClient.createTask as unknown as {
  mockResolvedValue: (v: unknown) => void;
  mockRejectedValue: (e: unknown) => void;
  mock: { calls: Array<[Record<string, unknown>, string | undefined]> };
};

beforeEach(async () => {
  useProjectsStore.setState({ projects: [], activeProjectId: null, loaded: false });
  useGoalsStore.setState({ goals: [], loading: false, saving: false, error: null });
  await db.goals.clear();
  vi.clearAllMocks();
});

describe("goals store (CEO mode)", () => {
  it("creates a real kanban task and persists the goal with its task id", async () => {
    createTask.mockResolvedValue({ id: "t_abc123", title: "Ship org chart", status: "todo" });

    const goal = await useGoalsStore.getState().createGoal({
      title: "  Ship org chart  ",
      acceptanceCriteria: "- roles render\n- DM still works",
      assignee: "developer",
    });

    expect(createTask.mock.calls).toHaveLength(1);
    const [input, board] = createTask.mock.calls[0];
    // Title is trimmed; the acceptance criteria ride along as the task body.
    expect(input.title).toBe("Ship org chart");
    expect(String(input.body)).toContain("roles render");
    expect(input.assignee).toBe("developer");
    // No active project → the default board.
    expect(board).toBe("");

    expect(goal.kanbanTaskId).toBe("t_abc123");
    const rows = await db.goals.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].kanbanTaskId).toBe("t_abc123");
    expect(useGoalsStore.getState().goals).toHaveLength(1);
    expect(useGoalsStore.getState().saving).toBe(false);
  });

  it("does not persist a goal when the board rejects the create", async () => {
    createTask.mockRejectedValue(new Error("kanban create HTTP 502"));

    await expect(useGoalsStore.getState().createGoal({ title: "Nope", acceptanceCriteria: "" })).rejects.toThrow("502");

    // The local list must never claim work that isn't on the board.
    expect(await db.goals.count()).toBe(0);
    expect(useGoalsStore.getState().goals).toHaveLength(0);
    expect(useGoalsStore.getState().error).toContain("502");
    expect(useGoalsStore.getState().saving).toBe(false);
  });

  it("scopes the task to the active project's board slug", async () => {
    useProjectsStore.setState({
      projects: [{ id: "p1", slug: "talaria", name: "Talaria", createdAt: 1, updatedAt: 1 }],
      activeProjectId: "p1",
      loaded: true,
    });
    createTask.mockResolvedValue({ id: "t_scoped", title: "Scoped", status: "todo" });

    await useGoalsStore.getState().createGoal({ title: "Scoped", acceptanceCriteria: "" });

    expect(createTask.mock.calls[0][1]).toBe("talaria");
  });

  it("removeGoal deletes the local row without touching the board", async () => {
    createTask.mockResolvedValue({ id: "t_keep", title: "Keep", status: "todo" });
    const goal = await useGoalsStore.getState().createGoal({ title: "Keep", acceptanceCriteria: "" });

    await useGoalsStore.getState().removeGoal(goal.id as number);

    expect(await db.goals.count()).toBe(0);
    expect(useGoalsStore.getState().goals).toHaveLength(0);
    // Deleting a goal must not archive the task it created.
    expect(createTask.mock.calls).toHaveLength(1);
  });

  it("rejects an empty title without calling the board", async () => {
    await expect(useGoalsStore.getState().createGoal({ title: "   ", acceptanceCriteria: "" })).rejects.toThrow(
      "title is required"
    );
    expect(createTask.mock.calls).toHaveLength(0);
    expect(await db.goals.count()).toBe(0);
  });
});
