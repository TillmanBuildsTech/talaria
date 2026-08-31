import { usePrsStore } from "../stores/prs";

type RepoPickerProps = {
  // Active project scope (P9). When set, the picker only lists repos attached
  // to that project and highlights the project's attached repo as the active
  // selection (derived by PrPanel). When null (global/unassigned scope), the
  // full connected repo list is shown with the user's last-picked selection.
  project?: string | null;
  scopeFullName?: string | null;
};

// Left-hand repo picker for the PRs module (§9.2). Shows the connected account's
// repos (owner + collaborator), keeps the last selection via the store, and
// loads that repo's open PRs on select. When a project is active the list is
// scoped to that project's attached repo (P9), mirroring the Deployments
// module. Distinct from the repo-browser module.
export function RepoPicker({ project, scopeFullName }: RepoPickerProps) {
  const { repos, activeFullName, loadingRepos, selectRepo, refreshRepos } = usePrsStore();

  // Project-scoped view: only the active project's attached repo is listed;
  // the effective active selection is the attached repo (PrPanel derives it).
  const effActiveFullName = project ? scopeFullName ?? null : activeFullName;
  const visibleRepos = project && scopeFullName ? repos.filter((r) => r.fullName === scopeFullName) : repos;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 flex items-center justify-between border-b border-slate-800">
        <p className="text-[10px] uppercase tracking-wider text-slate-500">Repositories</p>
        <button
          type="button"
          onClick={() => void refreshRepos()}
          className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
          aria-label="Refresh repos"
        >
          Refresh
        </button>
      </div>

      {loadingRepos && repos.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-slate-500 py-8">Loading repositories…</div>
      ) : visibleRepos.length === 0 ? (
        <div className="px-3 py-6 text-center">
          <p className="text-sm text-slate-400">{project ? "No repo attached to this project." : "No repos connected."}</p>
          <p className="text-[11px] text-slate-600 mt-1">
            {project
              ? "Attach a repo in the Repos module to view its pull requests."
              : "Connect a GitHub account in Settings to list your repositories and pull requests."}
          </p>
        </div>
      ) : (
        <ul className="px-2 py-2 space-y-0.5 overflow-y-auto">
          {visibleRepos.map((repo) => {
            const active = effActiveFullName === repo.fullName;
            return (
              <li key={repo.fullName}>
                <button
                  type="button"
                  onClick={() => void selectRepo(repo.fullName)}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                    active ? "bg-blue-600/20 text-slate-100" : "text-slate-300 hover:bg-slate-800/70"
                  }`}
                >
                  <svg className="w-3.5 h-3.5 shrink-0 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                    />
                  </svg>
                  <span className="font-mono text-[13px] truncate">{repo.fullName}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
