// Repo browser (M2, spec §9.1) — connected repos scoped per project, with
// expandable branches and recent commits. Mounted in both shells from
// @talaria/ui. Every repo / branch / commit links back to its GitHub URL (P3).
// Renders the standard connect affordance when no GitHub account is linked.
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useGitHubStore } from "../stores/github";
import { useProjectsStore } from "../stores/projects";
import { useReposStore } from "../stores/repos";
import { GitRepoNotice } from "./git-repo-notice";

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Collapse a commit message to its first line, trimming trailing punctuation.
function firstLine(msg: string): string {
  const line = (msg || "").split("\n")[0].trim();
  return line;
}

export function RepoBrowser() {
  const connections = useGitHubStore((s) => s.connections);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const activeProject = useProjectsStore(useShallow((s) => s.activeProject()));

  const repos = useReposStore((s) => s.repos);
  const branches = useReposStore((s) => s.branches);
  const commits = useReposStore((s) => s.commits);
  const openBranch = useReposStore((s) => s.openBranch);
  const loading = useReposStore((s) => s.loading);
  const error = useReposStore((s) => s.error);
  const loadRepos = useReposStore((s) => s.loadRepos);
  const loadBranches = useReposStore((s) => s.loadBranches);
  const loadCommits = useReposStore((s) => s.loadCommits);
  const attachRepo = useReposStore((s) => s.attachRepo);
  const detachRepo = useReposStore((s) => s.detachRepo);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const connected = connections.some((c) => c.status === "connected");

  // Reload repos when the active project scope changes or connections change.
  useEffect(() => {
    if (connected) loadRepos(activeProjectId);
  }, [activeProjectId, connected, loadRepos]);

  async function toggleRepo(repoId: string) {
    const repo = repos.find((r) => r.id === repoId);
    if (!repo) return;
    const willOpen = !expanded[repoId];
    setExpanded((v) => ({ ...v, [repoId]: willOpen }));
    if (willOpen && !branches[repoId]) {
      setBusy((b) => ({ ...b, [repoId]: true }));
      const branchList = await loadBranches(repo);
      // Pre-load commits for the default branch once branches are in.
      const defaultBranch = repo.defaultBranch;
      const hasDefault = branchList.some((b) => b.name === defaultBranch);
      const target = hasDefault ? defaultBranch : branchList[0]?.name;
      if (target) await loadCommits(repo, target);
      setBusy((b) => ({ ...b, [repoId]: false }));
    }
  }

  async function selectBranch(repoId: string, branch: string) {
    const repo = repos.find((r) => r.id === repoId);
    if (!repo) return;
    await loadCommits(repo, branch);
  }

  async function toggleAttach(repoId: string) {
    const repo = repos.find((r) => r.id === repoId);
    if (!repo) return;
    if (repo.project === activeProjectId) {
      await detachRepo(repoId);
    } else if (activeProjectId) {
      await attachRepo(repoId, activeProjectId);
    }
  }

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-2 px-6 text-center">
        <svg className="w-10 h-10 opacity-30" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
        <p className="text-sm">Connect GitHub to browse your repos.</p>
        <p className="text-xs text-slate-600">Open Settings → GitHub connection and log in.</p>
      </div>
    );
  }

  const projectLabel = activeProject ? activeProject.name : "Global / Unassigned";

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
      <GitRepoNotice />
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-300">Repos</h2>
        <span className="text-[10px] uppercase tracking-wider text-slate-500">scope · {projectLabel}</span>
      </div>

      {error && <p className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">{error}</p>}

      {loading && repos.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="w-3.5 h-3.5 border-2 border-slate-600 border-t-transparent rounded-full animate-spin" />
          Loading repos…
        </div>
      )}

      {!loading && repos.length === 0 && (
        <div className="text-xs text-slate-500 bg-slate-800/40 rounded-lg px-3 py-4 text-center">
          No accessible repos{activeProject ? " for this project scope" : ""}.
        </div>
      )}

      <ul className="divide-y divide-slate-800/60 border border-slate-800/60 rounded-xl overflow-hidden">
        {repos.map((repo) => {
          const isExpanded = !!expanded[repo.id];
          const branchList = branches[repo.id] || [];
          const activeBranch = openBranch[repo.id] || (branchList.some((b) => b.name === repo.defaultBranch) ? repo.defaultBranch : branchList[0]?.name);
          const commitKey = activeBranch ? `${repo.id}:${activeBranch}` : "";
          const commitList = commitKey ? commits[commitKey] || [] : [];
          const isAttached = !!activeProjectId && repo.project === activeProjectId;

          return (
            <li key={repo.id} className="bg-slate-900/40">
              {/* Repo row */}
              <div className="flex items-center gap-2 px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => toggleRepo(repo.id)}
                  className="flex-1 min-w-0 text-left flex items-center gap-2 group"
                  aria-expanded={isExpanded}
                >
                  <svg
                    className={`w-3.5 h-3.5 text-slate-500 shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${repo.isPrivate ? "bg-amber-400" : "bg-emerald-400"}`} title={repo.isPrivate ? "private" : "public"} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-slate-200 font-medium truncate">{repo.fullName}</span>
                    {repo.description && <span className="block text-xs text-slate-500 truncate">{repo.description}</span>}
                  </span>
                  {busy[repo.id] && <span className="w-3.5 h-3.5 border-2 border-slate-600 border-t-transparent rounded-full animate-spin shrink-0" />}
                </button>

                {activeProjectId && (
                  <button
                    type="button"
                    onClick={() => toggleAttach(repo.id)}
                    title={isAttached ? "Detach from this project" : "Attach to this project"}
                    className={`shrink-0 text-[11px] px-2 py-1 rounded-lg transition-colors border ${
                      isAttached
                        ? "bg-blue-600/20 border-blue-500/40 text-blue-300 hover:bg-blue-600/30"
                        : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                    }`}
                  >
                    {isAttached ? "Attached" : "Attach"}
                  </button>
                )}

                <a
                  href={repo.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                  title={`Open ${repo.fullName} on GitHub`}
                  aria-label={`Open ${repo.fullName} on GitHub`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </a>
              </div>

              {/* Expanded: branches + commits */}
              {isExpanded && (
                <div className="px-4 pb-3 pt-0.5 space-y-3 border-t border-slate-800/40">
                  {/* Branch selector */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] uppercase tracking-wider text-slate-600 shrink-0">branch</span>
                    <div className="flex gap-1.5 flex-wrap">
                      {branchList.length === 0 && <span className="text-xs text-slate-600">Loading branches…</span>}
                      {branchList.map((b) => (
                        <button
                          type="button"
                          key={b.name}
                          onClick={() => selectBranch(repo.id, b.name)}
                          className={`px-2 py-0.5 rounded-full text-[11px] font-mono transition-colors border ${
                            activeBranch === b.name
                              ? "bg-blue-600/20 border-blue-500/40 text-blue-300"
                              : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700"
                          }`}
                        >
                          {b.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Recent commits */}
                  <ul className="space-y-1">
                    {commitList.length === 0 && activeBranch && (
                      <li className="text-xs text-slate-600">No commits yet on {activeBranch}.</li>
                    )}
                    {commitList.map((c) => (
                      <li key={c.sha}>
                        <a
                          href={c.html_url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-start gap-2 group rounded-lg px-1.5 py-1 hover:bg-slate-800/50 transition-colors"
                          title={c.commit.message}
                        >
                          <span className="font-mono text-[11px] text-blue-400 shrink-0 mt-0.5">{shortSha(c.sha)}</span>
                          <span className="flex-1 min-w-0 text-xs text-slate-300 truncate">{firstLine(c.commit.message)}</span>
                          <span className="text-[11px] text-slate-600 shrink-0">{fmtDate(c.commit.author?.date)}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
