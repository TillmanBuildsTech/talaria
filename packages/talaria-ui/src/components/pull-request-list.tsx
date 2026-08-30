import type { CachedPullRequest } from "../db";
import { usePrsStore } from "../stores/prs";

type PullRequestListProps = {
  owner: string;
  repo: string;
  onOpen: (number: number) => void;
};

// A compact PR row per spec §6.5: title, author, `head → base`, a draft badge,
// and (only for open PRs in a protected repo) the mergeable_state hint. Tapping
// the row opens the detail drawer. Every row links back to GitHub (P3).
function PrRow({ pr, onClick }: { pr: CachedPullRequest; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left px-3 py-2.5 hover:bg-slate-800/60 rounded-lg transition-colors flex items-start gap-2"
      >
        <svg className="w-4 h-4 mt-0.5 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
          />
        </svg>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2">
            <span className="text-sm text-slate-200 truncate">{pr.title}</span>
            {pr.draft && (
              <span className="shrink-0 text-[9px] font-medium uppercase tracking-wide text-slate-500 bg-slate-800 rounded-full px-1.5 py-0.5">draft</span>
            )}
          </span>
          <span className="block text-[11px] text-slate-500 font-mono truncate mt-0.5">
            #{pr.number} · {pr.author} · {pr.headRef} <span className="text-slate-600">→</span> {pr.baseRef}
          </span>
        </span>
        <a
          href={pr.htmlUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 p-1 text-slate-500 hover:text-slate-300 rounded transition-colors"
          aria-label={`Open PR #${pr.number} on GitHub`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6v6m-9 3l9-9"
            />
          </svg>
        </a>
      </button>
    </li>
  );
}

export function PullRequestList({ owner, repo, onOpen }: PullRequestListProps) {
  const { prs: prsMap, loadingPrs, activeFullName, selectRepo, refreshDetail } = usePrsStore();
  const fullName = `${owner}/${repo}`;
  const prs = prsMap[fullName] ?? [];
  const isActive = activeFullName === fullName;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 flex items-center justify-between border-b border-slate-800">
        <button
          type="button"
          onClick={() => selectRepo(fullName)}
          className={`text-sm font-semibold ${isActive ? "text-slate-100" : "text-blue-400 hover:text-blue-300"} transition-colors text-left`}
        >
          {fullName}
        </button>
        <button
          type="button"
          onClick={() => refreshDetail(owner, repo, prs[0]?.number ?? 0).catch(() => {})}
          className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors shrink-0"
          disabled={prs.length === 0}
        >
          Refresh
        </button>
      </div>

      {loadingPrs && prs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-slate-500 py-10">Loading pull requests…</div>
      ) : prs.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-2 py-10">
          <svg className="w-8 h-8 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          <p className="text-sm">No open pull requests.</p>
        </div>
      ) : (
        <ul className="px-2 py-2 space-y-0.5 overflow-y-auto flex-1">
          {prs.map((pr) => (
            <PrRow key={pr.id} pr={pr} onClick={() => onOpen(pr.number)} />
          ))}
        </ul>
      )}
    </div>
  );
}