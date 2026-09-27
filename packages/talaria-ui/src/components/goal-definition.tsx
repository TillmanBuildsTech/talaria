// Goal Definition (CEO mode) — the "define the outcome, not the PR" entry point.
// A goal is a title (imperative outcome) plus its acceptance criteria; submitting
// creates a REAL kanban card on the active board via the /kanban-api bridge, so
// the work lands where the dispatcher (and the Command Center) already look.
//
// Goals are listed from the local store so the objective survives reloads and
// stays visible even while the board is unreachable.
import { useEffect, useState } from "react";
import { useGoalsStore } from "../stores/goals";
import { useProjectsStore } from "../stores/projects";

// Profiles a goal can be routed to. "" = leave unassigned (the board's default
// assignee / triage flow decides).
const ASSIGNEE_OPTIONS = ["", "developer", "quality-assurance", "product-owner", "operations", "researcher"];

export function GoalDefinition() {
  const goals = useGoalsStore((s) => s.goals);
  const saving = useGoalsStore((s) => s.saving);
  const error = useGoalsStore((s) => s.error);
  const init = useGoalsStore((s) => s.init);
  const createGoal = useGoalsStore((s) => s.createGoal);
  const removeGoal = useGoalsStore((s) => s.removeGoal);
  const activeProject = useProjectsStore((s) => s.activeProject());

  const [title, setTitle] = useState("");
  const [ac, setAc] = useState("");
  const [assignee, setAssignee] = useState("");
  const [createdTaskId, setCreatedTaskId] = useState<string | null>(null);

  useEffect(() => {
    void init();
  }, [init]);

  const boardLabel = activeProject?.slug || "default";

  async function submit() {
    if (!title.trim() || saving) return;
    setCreatedTaskId(null);
    try {
      const goal = await createGoal({ title, acceptanceCriteria: ac, assignee });
      setTitle("");
      setAc("");
      setAssignee("");
      setCreatedTaskId(goal.kanbanTaskId ?? null);
    } catch {
      /* the store has already surfaced the error; keep the input so nothing is lost */
    }
  }

  return (
    <div className="pt-1">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs font-medium text-slate-500">Goals</p>
        <span className="text-[11px] text-slate-600 font-mono">board: {boardLabel}</span>
      </div>

      <div className="space-y-2 bg-slate-800/50 rounded-lg p-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Goal — an imperative outcome (e.g. “Ship CEO mode org chart”)"
          className="w-full bg-slate-800 text-sm rounded-lg px-3 py-2 border-none outline-none
              focus:ring-2 focus:ring-blue-500/50 text-slate-100 placeholder-slate-600"
        />
        <textarea
          value={ac}
          onChange={(e) => setAc(e.target.value)}
          rows={3}
          placeholder={"Acceptance criteria — one per line\n- ..."}
          className="w-full bg-slate-800 text-sm rounded-lg px-3 py-2 border-none outline-none resize-y
              focus:ring-2 focus:ring-blue-500/50 text-slate-100 placeholder-slate-600"
        />
        <select
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          className="w-full bg-slate-800 text-sm rounded-lg px-3 py-2 border-none outline-none
              focus:ring-2 focus:ring-blue-500/50 text-slate-100"
        >
          {ASSIGNEE_OPTIONS.map((name) => (
            <option key={name || "unassigned"} value={name}>
              {name || "Unassigned (board triage)"}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={submit}
          disabled={!title.trim() || saving}
          className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
            title.trim() && !saving ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-slate-800 text-slate-500 cursor-not-allowed"
          }`}
        >
          {saving ? "Creating task…" : "Create kanban task"}
        </button>
        <p className="text-[11px] text-slate-600">
          Creates a real card on the <span className="font-mono text-slate-500">{boardLabel}</span> board via{" "}
          <code className="text-slate-500">hermes kanban create</code>.
        </p>
        {error && <p className="text-xs text-red-400">{error}</p>}
        {createdTaskId && <p className="text-xs text-emerald-400">Created task {createdTaskId}.</p>}
      </div>

      {goals.length > 0 && (
        <ul className="divide-y divide-slate-800/60 mt-2">
          {goals.map((goal) => (
            <li key={goal.id} className="py-2 flex items-start gap-3">
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-slate-200 truncate">{goal.title}</span>
                <span className="block text-xs text-slate-500 font-mono truncate">
                  {goal.board || "default"} · {goal.kanbanTaskId || "not created"}
                </span>
              </span>
              <button
                type="button"
                onClick={() => goal.id != null && removeGoal(goal.id)}
                className="text-xs text-red-400 hover:text-red-300 transition-colors shrink-0"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
