import { usePrsStore } from "../stores/prs";

// Left-hand repo picker for the PRs module (§9.2). Shows the connected account's
// repos (owner + collaborator), keeps the last selection via the store, and
// loads that repo's open PRs on select. Distinct from the repo-browser module.
export function RepoPicker() {
  const { repos, activeFullName, loadingRepos, selectRepo, refreshRepos } = usePrsStore();

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
      ) : repos.length === 0 ? (
        <div className="px-3 py-6 text-center">
          <p className="text-sm text-slate-400">No repos connected.</p>
          <p className="text-[11px] text-slate-600 mt-1">Connect a GitHub account in Settings to list your repositories and pull requests.</p>
        </div>
      ) : (
        <ul className="px-2 py-2 space-y-0.5 overflow-y-auto">
          {repos.map((repo) => {
            const active = activeFullName === repo.fullName;
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
