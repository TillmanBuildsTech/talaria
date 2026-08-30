// PR store — repos, pull requests, review + merge actions honoring the repo's
// real gates (M2 §5/§6, P1). Companion to `stores/github.ts` (auth). Pattern
// mirrors `stores/chat.ts`: store ↔ service ↔ Dexie.
//
// Caching rule (spec §5): repos / PRs / gates are cached for offline read;
// EVERY action (submit review, merge) always hits the live API and refreshes
// the cache. The cache is never a source of truth for a merge decision (P1).

import { create } from "zustand";
import db, {
  type CachedPullRequest,
  type CachedRepo,
} from "../db";
import { githubClient, type PullRequest, type PullRequestFile, type PullRequestReview, type ReviewEvent, type MergeMethod } from "../services/github";
import {
  approvingReviewCount,
  canMergePullRequest,
  defaultMergeMethod,
  deriveRepoGates,
  deriveReviewState,
  type MergeEligibility,
  type RepoGates,
  resolveRequiredChecks,
} from "../services/repo-gates";

function repoFullName(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

export type PrDetail = {
  pr: PullRequest;
  files: Array<PullRequestFile>;
  reviews: Array<PullRequestReview>;
  gates: RepoGates;
  reviewState: string;
  reviewCount: number;
  requiredCheckResults: Array<{ context: string; state: string; satisfied: boolean }>;
  mergeEligibility: MergeEligibility;
  defaultMethod: MergeMethod;
};

export type PrsState = {
  repos: Array<CachedRepo>;
  prs: Record<string, Array<CachedPullRequest>>; // keyed by fullName
  activeFullName: string | null;
  detail: PrDetail | null; // live detail for the open PR
  loadingRepos: boolean;
  loadingPrs: boolean;
  loadingDetail: boolean;
  acting: boolean; // a review/merge in flight
  error: string | null;
  lastRefreshedAt: number | null;

  init: () => Promise<void>;
  refreshRepos: () => Promise<void>;
  selectRepo: (fullName: string) => Promise<void>;
  refreshDetail: (owner: string, repo: string, number: number) => Promise<void>;
  refreshPrsFor: (owner: string, repo: string) => Promise<void>;
  loadPrDetail: (owner: string, repo: string, number: number) => Promise<void>;
  clearDetail: () => void;
  submitReview: (owner: string, repo: string, number: number, event: ReviewEvent, body?: string) => Promise<void>;
  merge: (owner: string, repo: string, number: number, method?: MergeMethod) => Promise<void>;
  clearError: () => void;
};

// Full-name of the last selected repo, persisted across reloads.
const SETTING_ACTIVE_REPO = "github:activeRepo";

// Hydrate the token the client needs for live API calls. Desktop stores the
// raw token in Dexie settings keyed by the connection's tokenRef; web keeps an
// opaque ref (the gateway holds the token) so nothing further is needed there.
async function withAuthenticatedClient(): Promise<void> {
  const conns = await db.connections.toArray();
  const active = conns.find((c) => c.status === "connected");
  if (!active) return;
  const stored = await db.settings.get(active.tokenRef).catch(() => undefined);
  if (stored?.value && !stored.value.startsWith("gw-ref")) {
    githubClient.setToken(stored.value);
  }
}

function toCachedRepo(g: import("../services/github").GitHubRepo): CachedRepo {
  return {
    fullName: g.full_name,
    name: g.name,
    owner: g.owner.login,
    defaultBranch: g.default_branch,
    htmlUrl: g.html_url,
    allowSquashMerge: g.allow_squash_merge !== false,
    allowMergeCommit: g.allow_merge_commit === true,
    allowRebaseMerge: g.allow_rebase_merge === true,
    updatedAt: Date.now(),
  };
}

function toCachedPr(fullName: string, p: PullRequest): CachedPullRequest {
  return {
    id: `${fullName}#${p.number}`,
    fullName,
    number: p.number,
    title: p.title,
    author: p.user?.login || "unknown",
    state: p.state,
    merged: !!p.merged,
    htmlUrl: p.html_url,
    headRef: p.head?.ref || "",
    headSha: p.head?.sha || "",
    baseRef: p.base?.ref || "",
    updatedAt: Date.now(),
    mergeableState: p.mergeable_state,
    draft: !!p.draft,
  };
}

export const usePrsStore = create<PrsState>((set, get) => ({
  repos: [],
  prs: {},
  activeFullName: null,
  detail: null,
  loadingRepos: false,
  loadingPrs: false,
  loadingDetail: false,
  acting: false,
  error: null,
  lastRefreshedAt: null,

  async init() {
    await get().refreshRepos();
  },

  async refreshRepos() {
    set({ loadingRepos: true, error: null });
    try {
      await withAuthenticatedClient();
      const gitRepos = await githubClient.listRepos();
      const cached = gitRepos.map(toCachedRepo);
      await db.prCachedRepos.bulkPut(cached);
      const active = (await db.settings.get(SETTING_ACTIVE_REPO).catch(() => undefined))?.value;
      set({
        repos: cached,
        activeFullName: active && cached.some((r) => r.fullName === active) ? active : null,
        loadingRepos: false,
        lastRefreshedAt: Date.now(),
      });
    } catch (err) {
      // Offline fallback: read cached repos so the module still renders (P8:
      // fail with a reason, keep cached data readable).
      const cached = await db.prCachedRepos.toArray().catch(() => []);
      set({
        repos: cached,
        loadingRepos: false,
        error: err instanceof Error ? err.message : "Could not load repos",
      });
    }
  },

  async selectRepo(fullName: string) {
    const known = get().repos.find((r) => r.fullName === fullName);
    if (!known) return;
    set({ activeFullName: fullName, detail: null, error: null });
    await db.settings.put({ key: SETTING_ACTIVE_REPO, value: fullName }).catch(() => {});
    const [owner, repo] = fullName.split("/");
    await get().refreshPrsFor(owner, repo);
  },

  // Load the open PRs for the active repo into the cache + store.
  async refreshPrsFor(owner: string, repo: string) {
    const fullName = repoFullName(owner, repo);
    set({ loadingPrs: true, error: null });
    try {
      const open = await githubClient.listPullRequests(owner, repo, "open");
      const cached: Array<CachedPullRequest> = open.map((p) => toCachedPr(fullName, p));
      // Replace this repo's rows so stale PRs (closed/merged upstream) vanish.
      await db.pullRequests.where("fullName").equals(fullName).delete();
      await db.pullRequests.bulkPut(cached);
      set((s) => ({ prs: { ...s.prs, [fullName]: cached }, loadingPrs: false, lastRefreshedAt: Date.now() }));
    } catch (err) {
      const cached = await db.pullRequests.where("fullName").equals(fullName).toArray().catch(() => []);
      set((s) => ({
        prs: { ...s.prs, [fullName]: cached },
        loadingPrs: false,
        error: err instanceof Error ? err.message : "Could not load pull requests",
      }));
    }
  },

  // Fetch the live detail for a PR: repos + branch protection => gates, the
  // PR, its files, reviews, head status. Refreshes the gate cache. Throws so
  // callers (open/refresh buttons) can surface the error.
  async refreshDetail(owner: string, repo: string, number: number) {
    const fullName = repoFullName(owner, repo);
    set({ loadingDetail: true, error: null });
    try {
      await withAuthenticatedClient();
      const repoMeta = await githubClient.getRepo(owner, repo);
      const protection = await githubClient.getBranchProtection(owner, repo, repoMeta.default_branch);
      const gates = deriveRepoGates(protection, repoMeta);
      const [pr, files, reviews] = await Promise.all([
        githubClient.getPullRequest(owner, repo, number),
        githubClient.getPullRequestFiles(owner, repo, number),
        githubClient.listReviews(owner, repo, number),
      ]);
      const [status, checkRuns] = await Promise.all([
        githubClient.getCommitStatus(owner, repo, pr.head.sha).catch(() => null),
        // S1: required checks for Actions jobs live in /commits/{sha}/check-runs,
        // not the legacy /status endpoint (which is empty for them). Load both
        // so the merge gate is never more restrictive than GitHub (§6.2).
        githubClient.getCheckRuns(owner, repo, pr.head.sha).catch(() => []),
      ]);
      const reviewState = deriveReviewState(reviews);
      const reviewCount = approvingReviewCount(reviews);
      const requiredCheckResults = resolveRequiredChecks(gates, status, checkRuns);
      const mergeEligibility = canMergePullRequest({ gates, pr, status, runs: checkRuns, reviewState, reviewCount });

      await db.repoGates.put({
        fullName,
        defaultBranch: repoMeta.default_branch,
        branchProtected: gates.branchProtected,
        requiredChecks: gates.requiredChecks,
        requiredReviewers: gates.requiredReviewers,
        enforceAdmins: gates.enforceAdmins,
        squashOnly: gates.squashOnly,
        allowMergeCommit: gates.allowMergeCommit,
        allowRebaseMerge: gates.allowRebaseMerge,
        fetchedAt: Date.now(),
      });

      set({
        detail: {
          pr,
          files,
          reviews,
          gates,
          reviewState,
          reviewCount,
          requiredCheckResults,
          mergeEligibility,
          defaultMethod: defaultMergeMethod(gates),
        },
        loadingDetail: false,
        lastRefreshedAt: Date.now(),
      });
    } catch (err) {
      set({ loadingDetail: false, error: err instanceof Error ? err.message : "Could not load PR detail" });
      throw err;
    }
  },

  // Exposed as a convenience so the UI can open a PR and (re)load its list.
  async loadPrDetail(owner, repo, number) {
    set({ detail: null });
    await get().refreshDetail(owner, repo, number);
  },

  clearDetail() {
    set({ detail: null });
  },

  async submitReview(owner, repo, number, event, body) {
    set({ acting: true, error: null });
    try {
      await withAuthenticatedClient();
      await githubClient.submitReview(owner, repo, number, event, body);
      await get().refreshDetail(owner, repo, number);
      set({ acting: false });
    } catch (err) {
      set({ acting: false, error: err instanceof Error ? err.message : "Review failed" });
      throw err;
    }
  },

  async merge(owner, repo, number, method) {
    set({ acting: true, error: null });
    try {
      await withAuthenticatedClient();
      const detail = get().detail;
      if (detail && !detail.mergeEligibility.mergeable) {
        set({ acting: false, error: detail.mergeEligibility.reasons.join("; ") || "Merge gated by repo rules" });
        return;
      }
      const chosen = method ?? (get().detail?.defaultMethod ?? "squash");
      const result = await githubClient.mergePullRequest(owner, repo, number, chosen);
      if (!result.merged) {
        // GitHub rejected the merge (405/409/422) — surface its message verbatim.
        set({ acting: false, error: result.message || `GitHub refused the merge (${result.status})` });
        return;
      }
      // Refresh the PR list + detail to reflect the merge.
      await get().refreshPrsFor(owner, repo);
      await get().refreshDetail(owner, repo, number);
      set({ acting: false });
    } catch (err) {
      set({ acting: false, error: err instanceof Error ? err.message : "Merge failed" });
      throw err;
    }
  },

  clearError() {
    set({ error: null });
  },
}));