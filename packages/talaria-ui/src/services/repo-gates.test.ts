import { describe, expect, it } from "vitest";
import {
  allowGreen,
  allowedMergeMethods,
  approvingReviewCount,
  canMergePullRequest,
  defaultMergeMethod,
  deriveRepoGates,
  deriveReviewState,
  resolveRequiredChecks,
} from "./repo-gates";
import type { BranchProtectionResult, CombinedStatus, GitHubRepo, PullRequest, PullRequestReview } from "./github";

// Helpers to build realistic fixtures quickly.
function protection(partial: Partial<NonNullable<BranchProtectionResult["data"]>> = {}, status = 200): BranchProtectionResult {
  return {
    status,
    data: status === 200 ? (partial as never) : null,
  };
}

function repo(partial: Partial<GitHubRepo> = {}): GitHubRepo {
  return {
    id: 1,
    name: "serv",
    full_name: "TillmanBuildsTech/serv",
    private: false,
    default_branch: "main",
    html_url: "https://github.com/TillmanBuildsTech/serv",
    owner: { login: "TillmanBuildsTech" },
    allow_squash_merge: true,
    allow_merge_commit: false,
    allow_rebase_merge: false,
    ...partial,
  };
}

function pr(partial: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 10,
    title: "Fix",
    state: "open",
    html_url: "https://github.com/o/r/pull/10",
    head: { ref: "fix", sha: "abc123" },
    base: { ref: "main", sha: "def456" },
    mergeable_state: "clean",
    ...partial,
  };
}

function status(state: string): CombinedStatus {
  return { state, statuses: [{ context: "ci", state }] };
}

function reviews(...states: Array<{ login: string; state: string }>): Array<PullRequestReview> {
  return states.map((s, i) => ({
    id: i,
    user: { login: s.login },
    state: s.state,
  }));
}

describe("deriveRepoGates — the repo's real gates are discovered, not assumed (P1)", () => {
  it("unprotected branch (404) => no PR ceremony, direct push allowed", () => {
    const g = deriveRepoGates(protection({}, 404), repo());
    expect(g.branchProtected).toBe(false);
    expect(g.directPushAllowed).toBe(true);
    expect(g.requiredReviewers).toBe(0);
    expect(g.requiredChecks).toEqual([]);
  });

  it("protected branch surfaces required checks, reviewers, squash-only", () => {
    const g = deriveRepoGates(
      protection({
        required_status_checks: { contexts: ["ci", "CodeQL"], strict: true },
        required_pull_request_reviews: { required_approving_review_count: 2 },
        enforce_admins: { enabled: true },
      }),
      repo()
    );
    expect(g.branchProtected).toBe(true);
    expect(g.requiredChecks).toEqual(["ci", "CodeQL"]);
    expect(g.requiredReviewers).toBe(2);
    expect(g.enforceAdmins).toBe(true);
    // serv is squash-only (squash on, merge/rebase off).
    expect(g.squashOnly).toBe(true);
    expect(g.allowMergeCommit).toBe(false);
    expect(g.directPushAllowed).toBe(false);
  });

  it("merge-commit-only repo disables squash-only", () => {
    const g = deriveRepoGates(protection({}, 404), repo({ allow_squash_merge: false, allow_merge_commit: true }));
    expect(g.squashOnly).toBe(false);
    expect(g.allowMergeCommit).toBe(true);
  });

  it("a protected branch with merge-commit allowed is NOT squash-only", () => {
    const g = deriveRepoGates(
      protection({ required_pull_request_reviews: { required_approving_review_count: 1 } }),
      repo({ allow_squash_merge: true, allow_merge_commit: true })
    );
    expect(g.branchProtected).toBe(true);
    expect(g.squashOnly).toBe(false);
  });

  it("surfaces allowSquash from repo.allow_squash_merge (S2 regression)", () => {
    expect(deriveRepoGates(protection({}, 404), repo()).allowSquash).toBe(true);
    expect(deriveRepoGates(protection({}, 404), repo({ allow_squash_merge: false })).allowSquash).toBe(false);
  });
});

describe("allowedMergeMethods — squash only when allow_squash_merge (S2 regression)", () => {
  it("merge-commit-only repo does NOT offer squash", () => {
    const g = deriveRepoGates(protection({}, 404), repo({ allow_squash_merge: false, allow_merge_commit: true, allow_rebase_merge: false }));
    expect(allowedMergeMethods(g)).toEqual(["merge"]);
  });

  it("squash-only repo offers only squash", () => {
    const g = deriveRepoGates(protection({}, 404), repo());
    expect(allowedMergeMethods(g)).toEqual(["squash"]);
  });

  it("no permitted method => empty list (dead guard now live)", () => {
    const g = deriveRepoGates(protection({}, 404), repo({ allow_squash_merge: false, allow_merge_commit: false, allow_rebase_merge: false }));
    expect(allowedMergeMethods(g)).toEqual([]);
  });

  it("merge+rebase, no squash => both offered, no squash", () => {
    const g = deriveRepoGates(protection({}, 404), repo({ allow_squash_merge: false, allow_merge_commit: true, allow_rebase_merge: true }));
    expect(allowedMergeMethods(g)).toEqual(["merge", "rebase"]);
  });
});

describe("deriveReviewState — latest review per reviewer (§6.4)", () => {
  it("approved wins when any reviewer approved last", () => {
    expect(deriveReviewState(reviews({ login: "a", state: "CHANGES_REQUESTED" }, { login: "b", state: "APPROVED" }))).toBe("approved");
  });

  it("changes_requested when the latest submitted review asks for changes", () => {
    expect(deriveReviewState(reviews({ login: "a", state: "APPROVED" }, { login: "a", state: "CHANGES_REQUESTED" }))).toBe("changes_requested");
  });

  it("none when there are no submitted reviews (pending skipped)", () => {
    expect(deriveReviewState(reviews({ login: "a", state: "PENDING" }))).toBe("none");
    expect(deriveReviewState([])).toBe("none");
  });

  it("approvingReviewCount counts distinct approving reviewers", () => {
    expect(approvingReviewCount(reviews({ login: "a", state: "APPROVED" }, { login: "a", state: "CHANGES_REQUESTED" }, { login: "b", state: "APPROVED" }))).toBe(2);
  });
});

describe("resolveRequiredChecks — a required check is never pre-approvable (P1)", () => {
  it("maps present + passing contexts to satisfied", () => {
    const g = deriveRepoGates(protection({ required_status_checks: { contexts: ["ci"] } }), repo());
    const r = resolveRequiredChecks(g, { state: "success", statuses: [{ context: "ci", state: "success" }] });
    expect(r).toEqual([{ context: "ci", state: "success", satisfied: true }]);
  });

  it("a missing context is NOT satisfied", () => {
    const g = deriveRepoGates(protection({ required_status_checks: { contexts: ["CodeQL"] } }), repo());
    const r = resolveRequiredChecks(g, { state: "success", statuses: [{ context: "ci", state: "success" }] });
    expect(r[0]).toEqual({ context: "CodeQL", state: "missing", satisfied: false });
  });

  it("an unprotected repo has no required checks regardless of contexts listed", () => {
    const g = deriveRepoGates(protection({}, 404), repo());
    expect(resolveRequiredChecks(g, status("success"))).toEqual([]);
  });

  it("S1: resolves an Actions required check from check runs even when legacy status is empty", () => {
    const g = deriveRepoGates(protection({ required_status_checks: { contexts: ["Build & test"] } }), repo());
    const emptyLegacy = { state: "pending", statuses: [] }; // live GitHub reality for Actions
    const runs = [{ id: 1, name: "Build & test", status: "completed", conclusion: "success", headSha: "abc123", htmlUrl: "https://github.com/o/r/checks/1" }];
    const r = resolveRequiredChecks(g, emptyLegacy, runs);
    expect(r).toEqual([{ context: "Build & test", state: "success", satisfied: true }]);
  });

  it("S1: a passing check run enables merge even though legacy /status is empty", () => {
    const g = deriveRepoGates(
      protection({ required_status_checks: { contexts: ["Build & test"] }, required_pull_request_reviews: { required_approving_review_count: 1 } }),
      repo()
    );
    const emptyLegacy = { state: "pending", statuses: [] };
    const runs = [{ id: 1, name: "Build & test", status: "completed", conclusion: "success", headSha: "abc123", htmlUrl: "https://github.com/o/r/checks/1" }];
    const e = canMergePullRequest({ gates: g, pr: pr(), status: emptyLegacy, runs, reviewState: "approved", reviewCount: 1 });
    expect(e.mergeable).toBe(true);
    expect(e.reasons).toEqual([]);
  });

  it("S1: a failing check run gates merge (not more permissive)", () => {
    const g = deriveRepoGates(protection({ required_status_checks: { contexts: ["Build & test"] } }), repo());
    const runs = [{ id: 1, name: "Build & test", status: "completed", conclusion: "failure", headSha: "abc123", htmlUrl: "https://github.com/o/r/checks/1" }];
    const r = resolveRequiredChecks(g, { state: "failure", statuses: [] }, runs);
    expect(r).toEqual([{ context: "Build & test", state: "failure", satisfied: false }]);
  });

  it("S1: an in-progress check run is pending, not satisfied", () => {
    const g = deriveRepoGates(protection({ required_status_checks: { contexts: ["Build & test"] } }), repo());
    const runs = [{ id: 1, name: "Build & test", status: "in_progress", conclusion: null, headSha: "abc123", htmlUrl: "https://github.com/o/r/checks/1" }];
    const r = resolveRequiredChecks(g, { state: "pending", statuses: [] }, runs);
    expect(r).toEqual([{ context: "Build & test", state: "pending", satisfied: false }]);
  });

  it("S1: legacy status contexts still resolve when no check run matches (no regression)", () => {
    const g = deriveRepoGates(protection({ required_status_checks: { contexts: ["ci"] } }), repo());
    const runs = [{ id: 1, name: "Build & test", status: "completed", conclusion: "success", headSha: "abc123", htmlUrl: "https://github.com/o/r/checks/1" }];
    const r = resolveRequiredChecks(g, { state: "success", statuses: [{ context: "ci", state: "success" }] }, runs);
    expect(r).toEqual([{ context: "ci", state: "success", satisfied: true }]);
  });
});

describe("canMergePullRequest — the P1 decision (portal never more/less permissive)", () => {
  const protectedGates = deriveRepoGates(
    protection({
      required_status_checks: { contexts: ["ci"] },
      required_pull_request_reviews: { required_approving_review_count: 1 },
    }),
    repo()
  );

  it("merge enabled on a protected repo when ALL gates pass", () => {
    const e = canMergePullRequest({
      gates: protectedGates,
      pr: pr(),
      status: { state: "success", statuses: [{ context: "ci", state: "success" }] },
      reviewState: "approved",
      reviewCount: 1,
    });
    expect(e.mergeable).toBe(true);
    expect(e.reasons).toEqual([]);
  });

  it("merge disabled when a required check fails", () => {
    const e = canMergePullRequest({
      gates: protectedGates,
      pr: pr(),
      status: { state: "failure", statuses: [{ context: "ci", state: "failure" }] },
      reviewState: "approved",
      reviewCount: 1,
    });
    expect(e.mergeable).toBe(false);
    expect(e.reasons).toContain('Required check "ci" is failure');
  });

  it("merge disabled when a required check hasn't run", () => {
    const e = canMergePullRequest({
      gates: protectedGates,
      pr: pr(),
      status: { state: "pending", statuses: [] },
      reviewState: "approved",
      reviewCount: 1,
    });
    expect(e.mergeable).toBe(false);
    expect(e.reasons).toContain('Required check "ci" hasn\'t run');
  });

  it("merge disabled on a merge conflict (dirty)", () => {
    const e = canMergePullRequest({
      gates: protectedGates,
      pr: pr({ mergeable_state: "dirty" }),
      status: { state: "success", statuses: [{ context: "ci", state: "success" }] },
      reviewState: "approved",
      reviewCount: 1,
    });
    expect(e.mergeable).toBe(false);
    expect(e.reasons[0]).toBe("Merge conflict — PR is dirty");
  });

  it("merge disabled when the required approval is missing", () => {
    const e = canMergePullRequest({
      gates: protectedGates,
      pr: pr(),
      status: { state: "success", statuses: [{ context: "ci", state: "success" }] },
      reviewState: "none",
      reviewCount: 0,
    });
    expect(e.mergeable).toBe(false);
    expect(e.reasons.some((r) => r.includes("approving review"))).toBe(true);
  });

  it("merge disabled when changes were requested", () => {
    const e = canMergePullRequest({
      gates: protectedGates,
      pr: pr(),
      status: { state: "success", statuses: [{ context: "ci", state: "success" }] },
      reviewState: "changes_requested",
      reviewCount: 0,
    });
    expect(e.mergeable).toBe(false);
    expect(e.reasons).toContain("Changes requested — needs a new approval");
  });

  it("unprotected repo imposes no ceremony — mergeable even with failing checks", () => {
    const freeGates = deriveRepoGates(protection({}, 404), repo());
    const e = canMergePullRequest({
      gates: freeGates,
      pr: pr({ mergeable_state: "dirty" }),
      status: status("failure"),
      reviewState: "none",
      reviewCount: 0,
    });
    expect(e.mergeable).toBe(true);
    expect(e.reasons).toEqual([]);
  });

  it("protected repo with NO permitted merge method disables merge (dead guard now live, S2)", () => {
    const noMethod = deriveRepoGates(
      protection({ required_status_checks: { contexts: ["ci"] } }),
      repo({ allow_squash_merge: false, allow_merge_commit: false, allow_rebase_merge: false })
    );
    const e = canMergePullRequest({
      gates: noMethod,
      pr: pr(),
      status: { state: "success", statuses: [{ context: "ci", state: "success" }] },
      reviewState: "approved",
      reviewCount: 1,
    });
    expect(e.mergeable).toBe(false);
    expect(e.reasons).toContain("Repo has no permitted merge method");
  });

  it("two-required-reviewer repo stays gated until both approve", () => {
    const two = deriveRepoGates(
      protection({ required_pull_request_reviews: { required_approving_review_count: 2 } }),
      repo()
    );
    const ok = canMergePullRequest({
      gates: two,
      pr: pr(),
      status: null,
      reviewState: "approved",
      reviewCount: 1,
    });
    expect(ok.mergeable).toBe(false);
    expect(ok.reasons.some((r) => r.includes("1 of 2 required"))).toBe(true);

    const both = canMergePullRequest({
      gates: two,
      pr: pr(),
      status: null,
      reviewState: "approved",
      reviewCount: 2,
    });
    expect(both.mergeable).toBe(true);
  });
});

describe("defaultMergeMethod (§6.3)", () => {
  it("squash-only repo defaults to squash", () => {
    expect(defaultMergeMethod(deriveRepoGates(protection({}, 404), repo()))).toBe("squash");
  });
  it("merge-commit-only repo defaults to merge", () => {
    expect(defaultMergeMethod(deriveRepoGates(protection({}, 404), repo({ allow_squash_merge: false, allow_merge_commit: true, allow_rebase_merge: false })))).toBe("merge");
  });
  it("rebase-only repo defaults to rebase", () => {
    expect(defaultMergeMethod(deriveRepoGates(protection({}, 404), repo({ allow_squash_merge: false, allow_merge_commit: false, allow_rebase_merge: true })))).toBe("rebase");
  });
  it("multiple allowed defaults to squash (GitHub modern default)", () => {
    expect(defaultMergeMethod(deriveRepoGates(protection({}, 404), repo({ allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: true })))).toBe("squash");
  });
});

describe("allowGreen", () => {
  it("maps conventional status state to a green/not-green boolean", () => {
    expect(allowGreen("success")).toBe(true);
    expect(allowGreen("pending")).toBe(false);
    expect(allowGreen("failure")).toBe(false);
  });
});