// Autonomy dial (P2, agent-orchestration.md) — per-task Swarm / Supervised /
// Manual. This is a dial, not a switch: it changes ONLY how a task is created
// and dispatched (how involved the user is). It never weakens the safety rails
// — same board, same dispatcher, same verification rules underpin all three.
// Selection is persisted locally via the kanban store.
import type { AutonomyMode } from "../services/kanban";
import { useKanbanStore } from "../stores/kanban";

const MODES: Array<{ mode: AutonomyMode; label: string; hint: string }> = [
  { mode: "swarm", label: "Swarm", hint: "PO decomposes, assigns, dispatches; agents run autonomously" },
  { mode: "supervised", label: "Supervised", hint: "Approve the task breakdown before dispatch" },
  { mode: "manual", label: "Manual", hint: "You pick agent + task, one at a time" },
];

const MODE_COLORS: Record<AutonomyMode, string> = {
  swarm: "#38bdf8",
  supervised: "#fbbf24",
  manual: "#fb7185",
};

export function AutonomyDial({ taskId }: { taskId: string }) {
  const autonomyFor = useKanbanStore((s) => s.autonomyFor);
  const setAutonomy = useKanbanStore((s) => s.setAutonomy);
  const mode = autonomyFor(taskId);

  return (
    <div className="flex items-center gap-1.5">
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: MODE_COLORS[mode] }}
        title={`Autonomy: ${mode}`}
      />
      <div className="flex items-center rounded-lg border border-slate-700 overflow-hidden" role="radiogroup" aria-label="Autonomy mode">
        {MODES.map((m) => {
          const active = m.mode === mode;
          return (
            <button
              key={m.mode}
              type="button"
              role="radio"
              aria-checked={active}
              title={m.hint}
              onClick={() => setAutonomy(taskId, m.mode)}
              className={`px-2 py-1 text-[10px] font-medium transition-colors ${
                active ? "text-slate-900" : "text-slate-400 hover:bg-slate-700/50"
              }`}
              style={active ? { backgroundColor: MODE_COLORS[m.mode] } : undefined}
            >
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
