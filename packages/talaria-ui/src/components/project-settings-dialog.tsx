// Project settings dialog — opened from the gear button beside the project
// picker (project-picker.tsx). Lets the user edit the active project's name,
// description, and color, or delete it (projects-spec.md §6.4 edit/delete).
// Global/unassigned has no settings entry — the gear button is only rendered
// when a real project is selected.
import { useEffect, useState } from "react";
import { PROJECT_COLORS, projectFolder, useProjectsStore } from "../stores/projects";
import { useReposStore } from "../stores/repos";
import type { Project } from "../db";

type ProjectSettingsDialogProps = {
  project: Project;
  onClose: () => void;
};

export function ProjectSettingsDialog({ project, onClose }: ProjectSettingsDialogProps) {
  const updateProject = useProjectsStore((s) => s.updateProject);
  const deleteProject = useProjectsStore((s) => s.deleteProject);

  const repos = useReposStore((s) => s.repos);
  const reposError = useReposStore((s) => s.error);
  const loadRepos = useReposStore((s) => s.loadRepos);
  const attachRepo = useReposStore((s) => s.attachRepo);
  const detachRepo = useReposStore((s) => s.detachRepo);

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [color, setColor] = useState(project.color ?? PROJECT_COLORS[0]);
  const [folder, setFolder] = useState(project.folder ?? projectFolder(project.slug));
  const [busy, setBusy] = useState(false);

  const trimmed = name.trim();
  const trimmedFolder = folder.trim() || projectFolder(project.slug);

  // Load the connected account's repos so the user can attach/detach them for
  // this project (P9 repo association, workflow-spec §10).
  useEffect(() => {
    loadRepos(null);
    // biome-ignore lint/correctness/useExhaustiveDependencies: load once on open
  }, []);

  async function save() {
    if (!trimmed || busy) return;
    setBusy(true);
    await updateProject(project.id, {
      name: trimmed,
      description: description.trim() || undefined,
      color,
      folder: trimmedFolder,
    });
    setBusy(false);
    onClose();
  }

  async function remove() {
    if (busy) return;
    if (!window.confirm(`Delete project "${project.name}"? This cannot be undone.`)) return;
    setBusy(true);
    await deleteProject(project.id);
    setBusy(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close project settings" onClick={onClose} />

      <div className="relative w-full max-w-md bg-slate-800 rounded-xl border border-slate-700 shadow-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700/60 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Project settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-700 transition-colors"
            aria-label="Close project settings"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-4 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5" htmlFor="project-settings-name">
              Name
            </label>
            <input
              id="project-settings-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
              }}
              className="w-full bg-slate-900 text-sm rounded-lg px-3 py-2.5 border-none outline-none focus:ring-2 focus:ring-blue-500/50 text-slate-100 placeholder-slate-600"
              placeholder="Project name"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5" htmlFor="project-settings-description">
              Description
            </label>
            <textarea
              id="project-settings-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full bg-slate-900 text-sm rounded-lg px-3 py-2.5 border-none outline-none focus:ring-2 focus:ring-blue-500/50 text-slate-100 placeholder-slate-600 resize-none"
              placeholder="What is this project for?"
            />
          </div>

          <div>
            <span className="block text-xs font-medium text-slate-400 mb-1.5">Color</span>
            <div className="flex items-center gap-2">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Use color ${c}`}
                  className={`w-6 h-6 rounded-full transition-transform ${color === c ? "ring-2 ring-white scale-110" : "hover:scale-110"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5" htmlFor="project-settings-folder">
              Server folder
            </label>
            <input
              id="project-settings-folder"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              className="w-full bg-slate-900 text-sm rounded-lg px-3 py-2.5 border-none outline-none focus:ring-2 focus:ring-blue-500/50 text-slate-100 placeholder-slate-600 font-mono text-xs"
              placeholder={projectFolder(project.slug)}
            />
            <p className="text-[11px] text-slate-600 mt-1">
              The workspace folder on the Hermes server this project maps to. Docs live under{" "}
              <code className="text-slate-500">{"<folder>/docs/"}</code>.
            </p>
          </div>

          <div className="border-t border-slate-700/40 pt-3">
            <span className="block text-xs font-medium text-slate-400 mb-1.5">Repos</span>
            {reposError && <p className="text-[11px] text-amber-400 mb-1.5">{reposError}</p>}
            {repos.length === 0 ? (
              <p className="text-[11px] text-slate-600">
                Connect a GitHub account to attach repositories to this project.
              </p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {repos.map((repo) => {
                  const isAttached = repo.project === project.id;
                  return (
                    <div
                      key={repo.id}
                      className="flex items-center gap-2 text-xs px-1.5 py-1 rounded-lg hover:bg-slate-900/50 transition-colors"
                    >
                      <span className="flex-1 min-w-0 font-mono truncate text-slate-300">{repo.fullName}</span>
                      <button
                        type="button"
                        onClick={() => (isAttached ? detachRepo(repo.id) : attachRepo(repo.id, project.id))}
                        className={`shrink-0 px-2 py-0.5 rounded-lg border text-[11px] transition-colors ${
                          isAttached
                            ? "bg-blue-600/20 border-blue-500/40 text-blue-300 hover:bg-blue-600/30"
                            : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                        }`}
                      >
                        {isAttached ? "Attached" : "Attach"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-slate-700/60 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="px-3 py-2 rounded-lg text-xs font-medium text-red-400 border border-red-500/30 hover:bg-red-500/10 transition-colors disabled:opacity-50"
          >
            Delete project
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-3 py-2 rounded-lg text-xs text-slate-400 hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy || !trimmed}
              className="px-4 py-2 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
