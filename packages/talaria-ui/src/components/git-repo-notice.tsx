// GitRepoNotice — inline affordance for git-dependent modules when the active
// project's folder is not a git repository (parent task: good UX when a git
// feature is unavailable because the project has no git repo configured).
//
// Renders nothing when there is no active project (global/unassigned scope) or
// when the active project's folder IS a git repo. When the active project has
// `isGitRepo === false`, show an explanatory notice in place of a silently
// broken/empty surface (P8: no silent ceremony — we do NOT hide the module).
import { useShallow } from "zustand/react/shallow";
import { useProjectsStore } from "../stores/projects";

export function GitRepoNotice() {
  const activeProject = useProjectsStore(useShallow((s) => s.activeProject()));
  if (!activeProject || activeProject.isGitRepo !== false) return null;
  return (
    <div className="mb-2 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
      <span className="shrink-0" aria-hidden="true">
        ⚠
      </span>
      <span>
        The folder for <strong className="text-amber-200">{activeProject.name}</strong> is not a git
        repository. This feature requires a git repository — attach a repo or pick a git folder in{" "}
        project settings to enable it.
      </span>
    </div>
  );
}
