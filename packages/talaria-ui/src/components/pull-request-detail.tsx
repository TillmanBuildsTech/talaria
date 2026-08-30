import { useState } from "react";
import { usePrsStore } from "../stores/prs";
import { type MergeMethod, type ReviewEvent } from "../services/github";
import { DiffViewer } from "./diff-viewer";

type PullRequestDetailProps = {
  owner: string;
  repo: string;
  number: number;
  onBack: () => void;
};

const REVIEW_STATE_LABEL: Record<string, { text: string; cls: string }> = {
  none: { text: "No reviews yet", cls: "text-slate-400" },
  approved: { text: "✓ Approved", cls: "text-emerald-400" },
  changes_requested: { text: "Changes requested", cls: "text-amber-400" },
  pending: { text: "Review pending", cls: "text-slate-400" },
};

export function PullRequestDetail({ owner, repo, number, onBack }: PullRequestDetailProps) {
  const { detail, acting, error, refreshDetail, submitReview, merge, clearError } = usePrsStore();
  const [body, setBody] = useState("");
  const [method, setMethod] = useState<MergeMethod | null>(null);
  const [confirmingMerge, setConfirmingMerge] = useState(false);

  if (!detail) return null;
  const { pr, files, gates, reviewState, reviewCount, requiredCheckResults, mergeEligibility, defaultMethod } = detail;

  async function review(event: ReviewEvent) {
    try {
      await submitReview(owner, repo, number, event, body.trim() || undefined);
      setBody("");
    } catch {
      // error surfaced via store
    }
  }

  async function doMerge() {
    if (!confirm("Merge pull request #" + number + "?")) return;
    await merge(owner, repo, number, method ?? defaultMethod);
    setConfirmingMerge(false);
  }

  const methods: Array<{ value: MergeMethod; label: string }> = [{ value: defaultMethod, label: defaultMethod }];
  const seen = new Set<MergeMethod>([defaultMethod]);
  for (const m of ["squash", "merge", "rebase"] as MergeMethod[]) {
    const permitted = m === "merge" ? gates.allowMergeCommit : m === "rebase" ? gates.allowRebaseMerge : gates.allowSquash;
    if (!seen.has(m) && permitted) {
      methods.push({ value: m, label: m });
      seen.add(m);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onBack} className="p-1 rounded hover:bg-slate-800 text-slate-400 transition-colors" aria-label="Back to list">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-sm font-semibold text-slate-100 flex-1 min-w-0 truncate">
            #{pr.number} {pr.title}
          </h2>
          <a
            href={pr.html_url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
          >
            Open on GitHub ↗
          </a>
        </div>
        <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-500 font-mono">
          <span>
            {pr.user?.login || "unknown"} · {pr.head?.ref} <span className="text-slate-600">→</span> {pr.base?.ref}
          </span>
          <span className={`shrink-0 ${REVIEW_STATE_LABEL[reviewState]?.cls ?? "text-slate-400"}`}>
            {REVIEW_STATE_LABEL[reviewState]?.text ?? reviewState}
            {gates.requiredReviewers > 0 && ` · ${reviewCount}/${gates.requiredReviewers} approvals`}
          </span>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 px-3 py-2 text-xs text-red-300 bg-red-950/40 border border-red-900/50 rounded-lg flex items-start justify-between gap-2">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={clearError} className="shrink-0 text-red-400 hover:text-red-200" aria-label="Dismiss error">
            ✕
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Branch protection status */}
        {gates.branchProtected && (
          <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/60">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Required checks · branch protected</p>
            {requiredCheckResults.length === 0 ? (
              <p className="text-xs text-slate-500">No status checks are required on {pr.base?.ref}.</p>
            ) : (
              <ul className="space-y-1">
                {requiredCheckResults.map((c) => (
                  <li key={c.context} className="flex items-center gap-2 text-xs">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        c.satisfied ? "bg-emerald-500" : c.state === "pending" || c.state === "missing" ? "bg-amber-500" : "bg-red-500"
                      }`}
                    />
                    <span className="font-mono truncate text-slate-300">{c.context}</span>
                    <span className="text-slate-500 ml-auto flex-shrink-0">{c.state}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Review actions */}
        <div className="px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => review("APPROVE")}
              disabled={acting}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-xs font-medium transition-colors"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => review("REQUEST_CHANGES")}
              disabled={acting}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-xs font-medium transition-colors"
            >
              Request changes
            </button>
            <button
              type="button"
              onClick={() => review("COMMENT")}
              disabled={acting}
              className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 disabled:opacity-40 text-xs font-medium transition-colors"
            >
              Comment
            </button>
          </div>
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && review("COMMENT")}
            placeholder="Review body (optional)"
            className="mt-2 w-full bg-slate-800 text-xs rounded-lg px-3 py-2 border-none outline-none focus:ring-2 focus:ring-blue-500/50 text-slate-100 placeholder-slate-600"
          />
        </div>

        {/* Merge control — gated by the repo (P1) */}
        <div className="px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmingMerge(true)}
              disabled={!mergeEligibility.mergeable || acting}
              title={mergeEligibility.mergeable ? "" : mergeEligibility.reasons.join("\n")}
              className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:bg-slate-800 disabled:text-slate-500 text-sm font-medium transition-colors disabled:cursor-not-allowed"
            >
              Merge pull request
            </button>
            {!mergeEligibility.mergeable && (
              <span className="text-[11px] text-slate-500 font-mono shrink-0">squash</span>
            )}
          </div>
          <select
            value={method ?? defaultMethod}
            onChange={(e) => setMethod(e.target.value as MergeMethod)}
            disabled={!gates.branchProtected}
            className="mt-2 text-xs bg-slate-800 text-slate-200 rounded-lg px-2 py-1.5 border-none outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            {methods.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>

          {mergeEligibility.mergeable ? (
            <p className="text-[11px] text-emerald-500 mt-1.5">
              {gates.branchProtected ? "All repo gates satisfied — merge enabled." : "Branch not protected — no PR ceremony imposed (P1)."}
            </p>
          ) : (
            <ul className="mt-1.5 space-y-0.5">
              {mergeEligibility.reasons.map((r) => (
                <li key={r} className="text-[11px] text-amber-400/90">
                  • {r}
                </li>
              ))}
            </ul>
          )}

          {confirmingMerge && (
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={() => void doMerge()} className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-xs font-medium" disabled={acting}>
                {acting ? "Merging…" : `Confirm ${method ?? defaultMethod} merge`}
              </button>
              <button type="button" onClick={() => setConfirmingMerge(false)} className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs" disabled={acting}>
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Diff */}
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Files changed</p>
            <button type="button" onClick={() => void refreshDetail(owner, repo, number).catch(() => {})} className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
              Refresh
            </button>
          </div>
          {files.length === 0 ? (
            <p className="text-xs text-slate-500">No files changed.</p>
          ) : (
            <div className="space-y-2">
              {files.map((f) => (
                <DiffViewer key={f.filename} file={f} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}