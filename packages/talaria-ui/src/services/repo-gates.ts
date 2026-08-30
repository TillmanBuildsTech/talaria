// RepoGates — the repo's REAL enforced merge gates (M2 §6 / P1).
//
// P1: the portal is never more or less permissive than the repo. Talaria
// mirrors whatever the repo actually enforces; it doesn't invent process for
// unprotected branches and doesn't relax gates for protected ones. This module
// is pure (no I/O) so the gate logic is unit-testable and shared by the UI
// (store, components) — a single source of truth for "can this merge?".

import type {
  BranchProtectionResult,
  CheckRun,
  CombinedStatus,
  GitHubRepo,
  MergeMethod,
  ProtectedBranch,
  PullRequest,
  PullRequestReview,
} from "./github";
import { checkOutcome } from "./github";

export type RepoGates = {
  branchProtected: boolean;
  requiredChecks: string[]; // required status-check contexts (classic branch protection)
  requiredReviewers: number; // required approving reviews (0 = none)
  enforceAdmins: boolean;
  squashOnly: boolean; // only squash merges allowed
  allowMergeCommit: boolean;
  allowRebaseMerge: boolean;
  directPushAllowed: boolean; // !branchProtected → agents can push straight to the branch like the user does
};

export type ReviewState = "none" | "approved" | "changes_requested" | "pending";

/**
 * Discover the repo's real gates from the two sources the spec mandates
 * (§6.1): branch-protection rules (404 => unprotected, which is meaningful)
 * and the repo's merge-settings from `GET /repos/{o}/{r}`.
 */
export function deriveRepoGates(protection: BranchProtectionResult, repo: GitHubRepo): RepoGates {
  const data: ProtectedBranch | null = protection.status === 200 ? protection.data : null;
  const branchProtected = protection.status === 200 && data !== null;

  const allowSquash = repo.allow_squash_merge !== false;
  const allowMergeCommit = repo.allow_merge_commit === true;
  const allowRebase = repo.allow_rebase_merge === true;
  // "Squash-only" = GitHub's squash toggle is on AND merge-commit/rebase are
  // both disabled. Applies regardless of protection (a repo can restrict
  // methods without protecting branches).
  const squashOnly = allowSquash && !allowMergeCommit && !allowRebase;

  return {
    branchProtected,
    requiredChecks: data?.required_status_checks?.contexts ?? [],
    requiredReviewers: data?.required_pull_request_reviews?.required_approving_review_count ?? 0,
    enforceAdmins: data?.enforce_admins?.enabled ?? false,
    squashOnly,
    allowMergeCommit,
    allowRebaseMerge: allowRebase,
    directPushAllowed: !branchProtected,
  };
}

/**
 * Derive the PR's review state from the latest review per reviewer (§6.4).
 * "approved" wins overall; otherwise a submitted CHANGES_REQUESTED surfaces.
 * Pending reviews (never submitted) are skipped.
 */
export function deriveReviewState(reviews: Array<PullRequestReview>): ReviewState {
  const latestByReviewer = new Map<string, string>();
  for (const r of reviews) {
    const login = r.user?.login;
    if (!login) continue;
    if (r.state === "PENDING") continue; // not a submitted review
    latestByReviewer.set(login, r.state);
  }
  const states = Array.from(latestByReviewer.values());
  if (states.includes("APPROVED")) return "approved";
  if (states.includes("CHANGES_REQUESTED")) return "changes_requested";
  return "none";
}

/** Count of distinct reviewers who submitted an approving review. */
export function approvingReviewCount(reviews: Array<PullRequestReview>): number {
  const reviewers = new Set<string>();
  for (const r of reviews) {
    if (r.user?.login && r.state === "APPROVED") reviewers.add(r.user.login);
  }
  return reviewers.size;
}

// A single-char "is this status a passing (green) state?" — used by the UI's
// check dots. "success" is the only green completion; anything else (pending,
// failure, error, unexpected) reads as not-green (P1: never pre-approve).
export function allowGreen(state: string | undefined | null): boolean {
  return state === "success";
}

/** Resolve a required status-check context to a machine state for the gate. */
export type RequiredCheckResult = {
  context: string;
  state: string; // success | failure | error | pending | missing
  satisfied: boolean;
};

/**
 * Resolve every required-check context against the PR head's check runs AND
 * legacy combined status (S1 fix: GitHub Actions jobs live only in
 * /commits/{sha}/check-runs; the legacy /commits/{sha}/status is empty for
 * them). A required context that neither source has reported yet is MISSING
 * (not satisfied) — the merge stays gated until it's present and green (P1:
 * never pre-approve a check the repo requires).
 *
 * Check runs win when present because they're the current, complete record
 * for Actions-backed required checks; legacy statuses still cover repos that
 * use commit-status contexts (some repos report those instead of/in addition
 * to check runs). Both are supported so the gate is never more restrictive
 * than GitHub (spec §6.2).
 */
export function resolveRequiredChecks(
  gates: RepoGates,
  status: CombinedStatus | null,
  runs: Array<CheckRun> = []
): Array<RequiredCheckResult> {
  if (!gates.branchProtected || gates.requiredChecks.length === 0) return [];
  const byContext = new Map<string, string>();
  for (const s of status?.statuses ?? []) byContext.set(s.context, s.state);
  // A check run's conclusion is the authoritative state for Actions jobs.
  for (const run of runs) byContext.set(run.name, checkOutcomeToState(run));
  return gates.requiredChecks.map((context) => {
    const state = byContext.get(context);
    if (!state) return { context, state: "missing", satisfied: false };
    return { context, state, satisfied: state === "success" };
  });
}

/** Map a check run's outcome to the gate's status vocabulary. */
function checkOutcomeToState(run: CheckRun): string {
  const outcome = checkOutcome(run);
  if (outcome === "pass") return "success";
  if (outcome === "fail") return "failure";
  return "pending";
}

/** The merge methods the repo permits (§6.3). Squash always when not the sole disallowed. */
export function allowedMergeMethods(gates: RepoGates): Array<MergeMethod> {
  const allowed: Array<MergeMethod> = [];
  if (gates.allowMergeCommit) allowed.push("merge");
  if (gates.allowRebaseMerge) allowed.push("rebase");
  // GitHub always permits squash merges unless every method is off; a repo with
  // none can't merge at all (surfaced as "no permitted merge method").
  allowed.push("squash");
  return allowed;
}

/**
 * The default merge method GitHub would use (§6.3): squash-only → squash;
 * merge-commit-only → merge; rebase-only → rebase; multiple allowed → squash
 * (GitHub's modern default).
 */
export function defaultMergeMethod(gates: RepoGates): MergeMethod {
  if (gates.allowMergeCommit && !gates.allowRebaseMerge) return "merge";
  if (gates.allowRebaseMerge && !gates.allowMergeCommit) return "rebase";
  return "squash";
}

export type MergeEligibility = {
  mergeable: boolean;
  /** Ordered list of unmet gates — shown verbatim on the disabled tooltip. */
  reasons: Array<string>;
};

/**
 * The P1 decision: can the user merge this PR right now, given the repo's real
 * gates? Pure — takes the gates, the PR's mergeable_state, the head's combined
 * status, and the review state, and returns an eligibility.
 *
 * Rules (§6.2):
 *  - Unprotected default branch → no PR ceremony: mergeable (the repo itself
 *    lets you push/merge).
 *  - Protected → merge disabled unless ALL of: mergeable_state clean, every
 *    required check passing, required approvals met, and a legal merge method.
 */
export function canMergePullRequest(input: {
  gates: RepoGates;
  pr: PullRequest;
  status: CombinedStatus | null;
  runs?: Array<CheckRun>;
  reviewState: ReviewState;
  reviewCount: number;
}): MergeEligibility {
  const { gates, pr, status, runs = [], reviewState, reviewCount } = input;

  if (!gates.branchProtected) {
    return { mergeable: true, reasons: [] };
  }

  const reasons: Array<string> = [];
  const ms = pr.mergeable_state;
  if (ms === "dirty") {
    reasons.push("Merge conflict — PR is dirty");
  } else if (ms === "blocked") {
    reasons.push("Merge blocked (protected branch rules)");
  } else if (ms && ms !== "clean" && ms !== "unknown") {
    reasons.push(`PR is not mergeable (${ms})`);
  }

  for (const c of resolveRequiredChecks(gates, status, runs)) {
    if (!c.satisfied) {
      reasons.push(
        c.state === "missing" ? `Required check "${c.context}" hasn't run` : `Required check "${c.context}" is ${c.state}`
      );
    }
  }

  if (gates.requiredReviewers > 0) {
    if (reviewState === "changes_requested") {
      reasons.push("Changes requested — needs a new approval");
    } else if (reviewState !== "approved") {
      reasons.push(
        `Needs ${gates.requiredReviewers} approving review${gates.requiredReviewers > 1 ? "s" : ""} (${reviewCount} current)`
      );
    }
    if (gates.requiredReviewers > 1 && reviewCount < gates.requiredReviewers) {
      reasons.push(`Only ${reviewCount} of ${gates.requiredReviewers} required approvals`);
    }
  }

  if (allowedMergeMethods(gates).length === 0) {
    reasons.push("Repo has no permitted merge method");
  }

  return { mergeable: reasons.length === 0, reasons };
}