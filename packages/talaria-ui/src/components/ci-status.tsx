import { useEffect, useMemo, useState } from "react";
import {
  checkOutcome,
  summarizeChecks,
  type CheckRun,
  type ChecksSummary,
  type WorkflowRun,
} from "../services/github";

// ---------------------------------------------------------------------------
// CI status surfacing (workflow-spec §7). Two views share the same helpers:
//   - CiChecksBadge  — compact "✓ 3/3 passing" chip for a PR row / branch head.
//   - CiChecksList   — the full per-check list with pass/fail/pending + links.
//   - CiWorkflowRuns — per-branch GitHub Actions runs (name, status, conclusion).
//   - CiStatusPanel  — fetches checks+workflow runs for a ref, composes the above,
//                      drives the P1 "can merge" gate, and auto-polls while a
//                      run is in_progress (light 30s cadence).
// All of it linkable back to GitHub (P3). Pure logic (summarizeChecks,
// checkOutcome) lives in services/github.ts and is unit-tested there.
// ---------------------------------------------------------------------------

type Outcome = "pass" | "fail" | "pending";

const outcomeStyles: Record<Outcome, string> = {
  pass: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  fail: "bg-red-500/15 text-red-300 ring-red-500/30",
  pending: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};
const outcomeDot: Record<Outcome, string> = {
  pass: "bg-emerald-400",
  fail: "bg-red-400",
  pending: "bg-amber-400",
};

function outcomeOf(run: CheckRun): Outcome {
  return checkOutcome(run);
}

// Compact summary chip — "✓ 3/3 passing" or "✕ CodeQL failing" etc.
export function CiChecksBadge({ summary }: { summary: ChecksSummary }) {
  if (summary.total === 0) {
    return <span className="text-xs text-slate-500">No checks</span>;
  }
  const pass = summary.required.length > 0 ? summary.requiredPassing : summary.passing;
  const total = summary.required.length > 0 ? summary.requiredTotal : summary.total;
  const unmet = summary.unmetRequired;
  const label = `${pass}/${total} passing`;
  const cls = summary.canMerge ? "text-emerald-300" : "text-amber-300";
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${cls}`} title={unmet.length ? `Required: ${unmet.join(", ")}` : undefined}>
      {summary.canMerge ? "✓" : "⚠"}
      <span>{label}</span>
      {unmet.length > 0 && <span className="text-slate-400">· {unmet.join(", ")}</span>}
    </span>
  );
}

// One check run row: dot + name + status/conclusion + link.
export function CheckRunRow({ run }: { run: CheckRun }) {
  const o = outcomeOf(run);
  const statusText =
    o === "pass" ? (run.conclusion === "neutral" ? "neutral" : "success") : o === "fail" ? (run.conclusion || "failed") : run.status.replace("_", " ");
  return (
    <li className="flex items-center justify-between gap-2 py-1.5 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <span className={`h-2 w-2 shrink-0 rounded-full ${outcomeDot[o]}`} />
        <span className="truncate text-slate-200">{run.name}</span>
        {run.appName && <span className="shrink-0 text-xs text-slate-500">{run.appName}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-xs ring-1 ${outcomeStyles[o]}`}>{statusText}</span>
        <a
          href={run.htmlUrl}
          target="_blank"
          rel="noreferrer"
          className="text-slate-400 hover:text-slate-200"
          title="Open on GitHub"
        >
          ↗
        </a>
      </div>
    </li>
  );
}

// The full check-runs list for a PR head / ref, with the summary header.
export function CiChecksList({ runs, required }: { runs: Array<CheckRun>; required?: Array<string> }) {
  const summary = useMemo(() => summarizeChecks(runs, required || []), [runs, required]);
  if (runs.length === 0) {
    return <p className="py-2 text-sm text-slate-500">No CI checks reported for this commit.</p>;
  }
  return (
    <div>
      <div className="mb-1 flex items-center justify-between border-b border-slate-800 pb-1">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Checks</span>
        <CiChecksBadge summary={summary} />
      </div>
      <ul>
        {runs.map((r) => (
          <CheckRunRow key={r.id} run={r} />
        ))}
      </ul>
      {summary.canMerge ? (
        <p className="mt-1 text-xs text-emerald-300">✓ All required checks pass — mergeable.</p>
      ) : summary.unmetRequired.length > 0 ? (
        <p className="mt-1 text-xs text-amber-300">Required checks not passing: {summary.unmetRequired.join(", ")}</p>
      ) : summary.pending > 0 ? (
        <p className="mt-1 text-xs text-amber-300">Waiting on {summary.pending} in-progress check(s)…</p>
      ) : (
        <p className="mt-1 text-xs text-red-300">Checks failing — merge blocked.</p>
      )}
    </div>
  );
}

// Per-branch GitHub Actions workflow runs.
export function CiWorkflowRuns({ runs }: { runs: Array<WorkflowRun> }) {
  if (runs.length === 0) {
    return <p className="py-2 text-sm text-slate-500">No workflow runs for this branch.</p>;
  }
  return (
    <div>
      <div className="mb-1 border-b border-slate-800 pb-1">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Workflow runs</span>
      </div>
      <ul>
        {runs.map((w) => {
          const done = w.status === "completed";
          const ok = done && w.conclusion === "success";
          const failed = done && w.conclusion !== "success" && w.conclusion !== "skipped" && w.conclusion !== "neutral";
          const pending = !done;
          const dot = ok ? "bg-emerald-400" : failed ? "bg-red-400" : "bg-amber-400";
          return (
            <li key={w.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
                <span className="truncate text-slate-200">
                  {w.displayTitle} <span className="text-slate-500">#{w.runNumber}</span>
                </span>
                <span className="shrink-0 text-xs text-slate-500">{w.event}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded px-1.5 py-0.5 text-xs ring-1 bg-slate-500/10 text-slate-300 ring-slate-500/30">
                  {pending ? w.status.replace("_", " ") : w.conclusion}
                </span>
                <a href={w.htmlUrl} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-slate-200" title="Open on GitHub">
                  ↗
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type CiStatusPanelProps = {
  owner: string;
  repo: string;
  ref: string; // head SHA for PR checks, or branch name for workflow runs
  required?: Array<string>;
  branch?: string; // when set, also fetch per-branch workflow runs
  autoPoll?: boolean; // poll while in_progress (default true)
  pollIntervalMs?: number; // default 30_000
  fetchChecks: (owner: string, repo: string, ref: string) => Promise<Array<CheckRun>>;
  fetchWorkflowRuns?: (owner: string, repo: string, branch: string) => Promise<Array<WorkflowRun>>;
};

export function CiStatusPanel({
  owner,
  repo,
  ref,
  required = [],
  branch,
  autoPoll = true,
  pollIntervalMs = 30_000,
  fetchChecks,
  fetchWorkflowRuns,
}: CiStatusPanelProps) {
  const [checks, setChecks] = useState<Array<CheckRun>>([]);
  const [runs, setRuns] = useState<Array<WorkflowRun>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      setError(null);
      try {
        const [checkRes, runRes] = await Promise.all([
          fetchChecks(owner, repo, ref),
          branch && fetchWorkflowRuns ? fetchWorkflowRuns(owner, repo, branch) : Promise.resolve([] as Array<WorkflowRun>),
        ]);
        if (cancelled) return;
        setChecks(checkRes);
        setRuns(runRes);
        setLoading(false);
        // Keep polling while anything is in_progress (light cadence).
        const busy = checkRes.some((c) => c.status !== "completed") || runRes.some((w) => w.status !== "completed");
        if (busy && autoPoll && !timer) {
          timer = setTimeout(load, pollIntervalMs);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load CI status");
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: ref/branch identity drives reload; fetch fns are stable props
  }, [owner, repo, ref, branch, required.join(","), autoPoll, pollIntervalMs, fetchChecks, fetchWorkflowRuns]);

  if (loading) {
    return <p className="py-2 text-sm text-slate-500">Loading CI status…</p>;
  }
  if (error) {
    return <p className="py-2 text-sm text-red-400">CI status unavailable: {error}</p>;
  }

  return (
    <div className="space-y-3">
      <CiChecksList runs={checks} required={required} />
      {branch && <CiWorkflowRuns runs={runs} />}
    </div>
  );
}
