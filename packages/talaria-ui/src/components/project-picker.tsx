// Project picker — the top-of-command-center selector for the active project
// scope (projects.md, P9). Sits in the shared App header so both shells (PWA
// + desktop) mount it. Lists every project plus the reserved global/unassigned
// scope; selecting one swaps the whole view/data namespace.
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useProjectsStore } from "../stores/projects";

const GLOBAL_COLOR = "#64748b";

export function ProjectPicker() {
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const activeProject = useProjectsStore(useShallow((s) => s.activeProject()));
  const setActiveProject = useProjectsStore((s) => s.setActiveProject);
  const createProject = useProjectsStore((s) => s.createProject);

  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const label = activeProject ? activeProject.name : "Global / Unassigned";
  const color = activeProject?.color || GLOBAL_COLOR;

  async function select(id: string | null) {
    await setActiveProject(id);
    setOpen(false);
  }

  async function submitCreate() {
    const name = nameDraft.trim();
    if (!name) return;
    const created = await createProject({ name });
    setNameDraft("");
    setCreating(false);
    await setActiveProject(created.id);
    setOpen(false);
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs transition-colors"
        title="Switch project scope"
        aria-label="Switch project scope"
      >
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="max-w-[140px] truncate text-slate-200 font-medium">{label}</span>
        <svg className="w-3 h-3 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          <button type="button" className="fixed inset-0 z-30" aria-label="Close project picker" onClick={() => setOpen(false)} />
          <div className="absolute left-0 mt-2 w-72 z-40 bg-slate-800 rounded-xl border border-slate-700 shadow-xl overflow-hidden">
            <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-700/60">
              Project scope
            </div>

            {/* Reserved global/unassigned scope */}
            <button
              type="button"
              onClick={() => select(null)}
              className="w-full text-left px-3 py-2 text-xs hover:bg-slate-700/60 transition-colors flex items-center gap-2"
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: GLOBAL_COLOR }} />
              <span className="flex-1">
                <span className="block text-slate-200 font-medium">Global / Unassigned</span>
                <span className="block text-[10px] text-slate-500">One-off work not bound to a project</span>
              </span>
              {activeProjectId === null && <span className="text-emerald-400">✓</span>}
            </button>

            <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-slate-500 border-t border-slate-700/60">
              Projects
            </div>
            {projects.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => select(p.id)}
                className="w-full text-left px-3 py-2 text-xs hover:bg-slate-700/60 transition-colors flex items-center gap-2"
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color || GLOBAL_COLOR }} />
                <span className="flex-1 min-w-0">
                  <span className="block text-slate-200 font-medium truncate">{p.name}</span>
                  {p.description && <span className="block text-[10px] text-slate-500 truncate">{p.description}</span>}
                </span>
                {activeProjectId === p.id && <span className="text-emerald-400">✓</span>}
              </button>
            ))}
            {projects.length === 0 && !creating && (
              <div className="px-3 py-2 text-xs text-slate-500">No projects yet — create one to scope work.</div>
            )}

            {creating ? (
              <div className="px-3 py-2 border-t border-slate-700/60 flex items-center gap-2">
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitCreate();
                    } else if (e.key === "Escape") {
                      setCreating(false);
                    }
                  }}
                  placeholder="Project name"
                  className="flex-1 bg-slate-900 text-xs rounded px-2 py-1.5 outline-none ring-1 ring-blue-500 text-slate-100"
                />
                <button
                  type="button"
                  onClick={submitCreate}
                  disabled={!nameDraft.trim()}
                  className={`px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                    nameDraft.trim() ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-slate-700 text-slate-400 cursor-not-allowed"
                  }`}
                >
                  Create
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="w-full text-left px-3 py-2 text-xs text-blue-400 hover:bg-slate-700/60 transition-colors border-t border-slate-700/60"
              >
                ＋ New project
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
