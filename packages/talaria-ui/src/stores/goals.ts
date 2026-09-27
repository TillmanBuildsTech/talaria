// Goals store (CEO mode) — locally-persisted objectives that each create a REAL
// kanban task through the serve.mjs bridge (POST /kanban-api/tasks → shells
// `hermes kanban create`). The Dexie row is the durable record; the board card
// is the unit of work the dispatcher can pick up.
//
// A goal is persisted ONLY after its task is created, so the local list never
// claims work that isn't on the board. On failure the error is surfaced and the
// form keeps its input, so nothing the user typed is lost.
import { create } from "zustand";
import db, { type Goal } from "../db";
import { activeBoardSlug, kanbanClient } from "../services/kanban";

export type CreateGoalInput = {
  title: string;
  acceptanceCriteria: string;
  assignee?: string;
  // Explicit board slug; defaults to the active project scope (P9).
  board?: string;
};

export type GoalsState = {
  goals: Goal[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  init: () => Promise<void>;
  createGoal: (input: CreateGoalInput) => Promise<Goal>;
  removeGoal: (id: number) => Promise<void>;
};

export const useGoalsStore = create<GoalsState>((set, get) => ({
  goals: [],
  loading: false,
  saving: false,
  error: null,

  async init() {
    set({ loading: true, error: null });
    try {
      const goals = await db.goals.orderBy("createdAt").reverse().toArray();
      set({ goals, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },

  async createGoal(input) {
    const title = input.title.trim();
    if (!title) throw new Error("title is required");
    const acceptanceCriteria = input.acceptanceCriteria.trim();
    const board = input.board ?? activeBoardSlug();

    set({ saving: true, error: null });
    try {
      // The task body carries the acceptance criteria verbatim (the board's
      // convention: title = imperative outcome, body = AC + pointers).
      const task = await kanbanClient.createTask(
        {
          title,
          body: acceptanceCriteria || undefined,
          assignee: input.assignee?.trim() || undefined,
        },
        board
      );

      const goal: Goal = {
        title,
        acceptanceCriteria,
        board,
        kanbanTaskId: task?.id ?? null,
        createdAt: Date.now(),
      };
      const id = await db.goals.add(goal);
      const saved: Goal = { ...goal, id: id as number };
      set({ goals: [saved, ...get().goals], saving: false });
      return saved;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, saving: false });
      throw err;
    }
  },

  async removeGoal(id) {
    await db.goals.delete(id);
    set({ goals: get().goals.filter((g) => g.id !== id) });
  },
}));
