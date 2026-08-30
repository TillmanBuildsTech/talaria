// Repo browser store (M2, spec §5.1) — connected repos per project, with
// expandable branches and recent commits. Local-first (P5): repos are cached
// in the Dexie `repos` table scoped per project (P9) so the browser renders
// offline; branches/commits are always fetched live (the cache is metadata,
// not a source of truth). Every artifact carries its GitHub URL (P3).
import { create } from "zustand";
import db, { type Repo } from "../db";
import { githubClient, type Branch, type CommitMeta, type RepoMeta } from "../services/github";

// Attach a repo to a project scope: repos belong to the active project. The
// global/unassigned scope (project = "") shows every accessible repo; once a
// project is active, only repos attached to it are listed.
export type ReposState = {
  repos: Array<Repo>;
  branches: Record<string, Array<Branch>>; // key: repoId
  commits: Record<string, Array<CommitMeta>>; // key: `${repoId}:${branch}`
  loading: boolean;
  error: string | null;
  // repoId → sha for the branch currently showing commits
  openBranch: Record<string, string>;

  loadRepos: (project: string | null) => Promise<void>;
  loadBranches: (repo: Repo) => Promise<Array<Branch>>;
  loadCommits: (repo: Repo, branch: string) => Promise<void>;
  attachRepo: (repoId: string, project: string) => Promise<void>;
  detachRepo: (repoId: string) => Promise<void>;
  reset: () => void;
};

function repoFromMeta(m: RepoMeta, project: string): Repo {
  return {
    id: m.full_name,
    owner: m.owner?.login || m.full_name.split("/")[0],
    name: m.name,
    fullName: m.full_name,
    defaultBranch: m.default_branch || "main",
    isPrivate: !!m.private,
    description: m.description ?? undefined,
    htmlUrl: m.html_url || `https://github.com/${m.full_name}`,
    project,
    lastFetchedAt: Date.now(),
  };
}

export const useReposStore = create<ReposState>((set, get) => ({
  repos: [],
  branches: {},
  commits: {},
  loading: false,
  error: null,
  openBranch: {},

  async loadRepos(project) {
    // Show repos attached to the given project. Global scope (null/"") lists
    // every accessible repo (cached + live).
    set({ loading: true, error: null });
    try {
      // Always hit the live API when connected so metadata stays fresh (cache
      // is never the source of truth). On failure we fall back to cache below.
      const live = await githubClient.listRepos();
      const liveRepos: Array<Repo> = live.map((m) => repoFromMeta(m, ""));
      // Persist cache, keeping project scoping on already-attached repos.
      const existing = await db.repos.toArray();
      const existingByFull = new Map(existing.map((r) => [r.fullName, r]));
      for (const r of liveRepos) {
        const prev = existingByFull.get(r.fullName);
        if (prev?.project) r.project = prev.project; // keep the repo's own project attachment
        await db.repos.put(r);
      }
      // Merge cached rows so a repo attached to this project shows even if the
      // connected account's /user/repos list doesn't include it.
      const scope = project ?? "";
      const cached = await db.repos.toArray();
      const byFull = new Map<string, Repo>();
      for (const r of liveRepos) byFull.set(r.fullName, r);
      for (const c of cached) if (!byFull.has(c.fullName)) byFull.set(c.fullName, c);
      const merged = [...byFull.values()]
        .filter((r) => (project ? r.project === scope || r.project === "" : true))
        .sort((a, b) => a.fullName.localeCompare(b.fullName));
      set({ repos: merged, loading: false });
    } catch (err) {
      // Offline / unauthenticated: fall back to whatever is cached so the
      // browser still renders repos we've seen before (P5).
      const scope = project ?? "";
      const cached = await db.repos.filter((r) => (project ? r.project === scope : true)).toArray();
      set({ repos: cached, loading: false, error: err instanceof Error ? err.message : "Could not load repos" });
    }
  },

  async loadBranches(repo) {
    try {
      const branches = await githubClient.listBranches(repo.owner, repo.name);
      set({ branches: { ...get().branches, [repo.id]: branches } });
      return branches;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Could not load branches" });
      return [];
    }
  },

  async loadCommits(repo, branch) {
    const key = `${repo.id}:${branch}`;
    try {
      const commits = await githubClient.listCommits(repo.owner, repo.name, branch);
      set({
        commits: { ...get().commits, [key]: commits },
        openBranch: { ...get().openBranch, [repo.id]: branch },
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Could not load commits" });
    }
  },

  async attachRepo(repoId, project) {
    const repo = get().repos.find((r) => r.id === repoId);
    if (!repo || !project) return;
    await db.repos.put({ ...repo, project });
    set({ repos: get().repos.map((r) => (r.id === repoId ? { ...r, project } : r)) });
  },

  async detachRepo(repoId) {
    const repo = get().repos.find((r) => r.id === repoId);
    if (!repo) return;
    await db.repos.put({ ...repo, project: "" });
    set({ repos: get().repos.map((r) => (r.id === repoId ? { ...r, project: "" } : r)) });
  },

  reset() {
    set({ repos: [], branches: {}, commits: {}, openBranch: {}, loading: false, error: null });
  },
}));
