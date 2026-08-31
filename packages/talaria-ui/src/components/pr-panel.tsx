import { useEffect, useMemo, useState } from "react";
import { usePrsStore } from "../stores/prs";
import { useProjectsStore } from "../stores/projects";
import { useReposStore } from "../stores/repos";
import { RepoPicker } from "./repo-picker";
import { PullRequestList } from "./pull-request-list";
import { PullRequestDetail } from "./pull-request-detail";
import { GitRepoNotice } from "./git-repo-notice";

// The PRs module (M2, spec §9). Left = repo browser, right-top = that repo's
// open PRs, right-main = the selected PR's detail (diff, review, gated merge).
// Mounted from the module switcher in both shells (apps/pwa + apps/desktop).
export function PrPanel({ onClose }: { onClose?: () => void }) {
  const activeFullName = usePrsStore((s) => s.activeFullName);
  const detail = usePrsStore((s) => s.detail);
  const loadPrDetail = usePrsStore((s) => s.loadPrDetail);
  const clearDetail = usePrsStore((s) => s.clearDetail);

  // Whole-app project scoping (P9): when a project is active, scope the PRs
  // module to that project's ATTACHED repo rather than the globally-persisted
  // selection. Global scope keeps the user's last-picked repo.
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const repos = useReposStore((s) => s.repos);
  const loadRepos = useReposStore((s) => s.loadRepos);
  const scopeRepo = useMemo(
    () => (activeProjectId ? repos.find((r) => r.project === activeProjectId) : undefined),
    [repos, activeProjectId]
  );
  useEffect(() => {
    if (activeProjectId) void loadRepos(activeProjectId);
    // biome-ignore lint/correctness/useExhaustiveDependencies: load once per scope change
  }, [activeProjectId, loadRepos]);

  // Effective active repo: the project's attached repo when a project is
  // active; otherwise the globally-persisted selection.
  const scopeFullName = scopeRepo?.fullName ?? null;
  const effActiveFullName = activeProjectId ? scopeFullName : activeFullName;
  const [owner, repo] = effActiveFullName?.split("/") ?? [];

  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!started) {
      setStarted(true);
      void usePrsStore.getState().init();
    }
  }, [started]);

  // Clear any open PR detail when switching repos or project scope.
  useEffect(() => {
    clearDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effActiveFullName]);

  function backToList() {
    clearDetail();
  }

  return (
    <>
      <GitRepoNotice />
      <div className="flex h-full min-h-0 border-b border-slate-800">
      {/* Repo browser */}
      <aside className="w-56 shrink-0 border-r border-slate-800 flex flex-col min-h-0">
        <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-200">Pull Requests</p>
          {onClose && (
            <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 transition-colors" aria-label="Close PRs">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <div className="flex-1 min-h-0">
          <RepoPicker project={activeProjectId} scopeFullName={scopeFullName} />
        </div>
      </aside>

      {/* PR list OR detail */}
      <main className="flex-1 min-w-0 min-h-0">
        {activeProjectId && !scopeRepo ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2 px-6 text-center">
            <p className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
              No repository is attached to this project. Attach one in the Repos module to view its pull requests.
            </p>
          </div>
        ) : owner && repo && detail ? (
          <PullRequestDetail owner={owner} repo={repo} number={detail.pr.number} onBack={backToList} />
        ) : owner && repo ? (
          <PullRequestList
            owner={owner}
            repo={repo}
            onOpen={(n) => {
              void loadPrDetail(owner, repo, n);
            }}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2 px-6 text-center">
            <svg className="w-10 h-10 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
            <p className="text-sm">Select a repository on the left, then open a pull request.</p>
          </div>
        )}
      </main>
      </div>
    </>
  );
}