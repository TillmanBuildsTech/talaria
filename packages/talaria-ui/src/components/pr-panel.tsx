import { useEffect, useState } from "react";
import { usePrsStore } from "../stores/prs";
import { RepoPicker } from "./repo-picker";
import { PullRequestList } from "./pull-request-list";
import { PullRequestDetail } from "./pull-request-detail";

// The PRs module (M2, spec §9). Left = repo browser, right-top = that repo's
// open PRs, right-main = the selected PR's detail (diff, review, gated merge).
// Mounted from the module switcher in both shells (apps/pwa + apps/desktop).
export function PrPanel({ onClose }: { onClose?: () => void }) {
  const activeFullName = usePrsStore((s) => s.activeFullName);
  const detail = usePrsStore((s) => s.detail);
  const loadPrDetail = usePrsStore((s) => s.loadPrDetail);
  const clearDetail = usePrsStore((s) => s.clearDetail);

  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!started) {
      setStarted(true);
      void usePrsStore.getState().init();
    }
  }, [started]);

  const [owner, repo] = activeFullName?.split("/") ?? [];

  // Clear any open PR detail when switching repos.
  useEffect(() => {
    clearDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFullName]);

  function backToList() {
    clearDetail();
  }

  return (
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
          <RepoPicker />
        </div>
      </aside>

      {/* PR list OR detail */}
      <main className="flex-1 min-w-0 min-h-0">
        {owner && repo && detail ? (
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
  );
}