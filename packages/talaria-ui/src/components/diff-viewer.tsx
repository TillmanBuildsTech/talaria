import { useMemo, useState } from "react";
import type { PullRequestFile } from "../services/github";

// Render a unified diff for one file using the GitHub-provided patch text. The
// portal shows diffs reviewable in-app (M2 acceptance) without fetching raw
// blobs: `GET …/pulls/{n}/files` returns a plain-text unified patch per file.
// Lines are classified from the diff hunk markers (+/-/space/context/@) so the
// output reads like GitHub's diff view — additions green, deletions red.
function DiffHunkBody({ patch }: { patch?: string }) {
  const rows = useMemo(() => {
    if (!patch) return [];
    // Split into lines, but keep hunk headers (starting with @@) intact.
    return patch.replace(/\r\n/g, "\n").split("\n");
  }, [patch]);

  if (rows.length === 0) {
    return <p className="px-3 py-2 text-xs text-slate-500 italic">No inline diff available.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <pre className="text-[11px] leading-5 font-mono text-slate-300">
        {rows.map((line, i) => {
          let cls = "bg-slate-900/60 text-slate-400"; // context / unchanged
          if (line.startsWith("+")) cls = "bg-emerald-950/50 text-emerald-300";
          else if (line.startsWith("-")) cls = "bg-red-950/50 text-red-300";
          else if (line.startsWith("@")) cls = "bg-slate-800/80 text-blue-300";
          return (
            <div key={i} className={`px-3 whitespace-pre ${cls}`}>
              {line}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

export function DiffViewer({ file }: { file: PullRequestFile }) {
  const [expanded, setExpanded] = useState<boolean>(true);
  const additions = file.additions ?? 0;
  const deletions = file.deletions ?? 0;

  return (
    <div className="rounded-lg border border-slate-800 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-slate-800/60 hover:bg-slate-800/80 transition-colors text-left"
      >
        <span className="text-[10px] font-mono text-slate-500 w-6 shrink-0">{file.status === "removed" ? "D" : file.status === "renamed" ? "R" : file.status === "added" ? "A" : "M"}</span>
        <span className="flex-1 min-w-0 font-mono text-[13px] text-slate-200 truncate">{file.filename}</span>
        <span className="shrink-0 flex items-center gap-2 text-[11px] font-mono">
          <span className="text-emerald-400">+{additions}</span>
          <span className="text-red-400">-{deletions}</span>
        </span>
        <svg
          className={`w-3.5 h-3.5 text-slate-500 transition-transform shrink-0 ${expanded ? "" : "-rotate-90"}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && <DiffHunkBody patch={file.patch} />}
    </div>
  );
}