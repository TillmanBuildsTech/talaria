// GitHub client — M2 auth (architecture.md "Connecting to GitHub").
//
// Two supported connection mechanisms:
//   1. OAuth Device Flow with a public Client ID only (no secret, no central
//      server) — the "Login with GitHub" button, same mechanism as `gh`.
//   2. Fine-grained PAT pasted in Settings (fallback, zero infra).
//
// Transport abstraction (P6 — one shared brain, both shells equal):
//   direct   — desktop (Tauri): the app calls GitHub's endpoints natively.
//              No CORS restriction. Token lives in the OS keychain / local.
//   gateway  — web (PWA): the browser cannot poll GitHub's OAuth token endpoint
//              (no CORS headers), so the token exchange and REST proxy are
//              routed through the user's OWN Hermes gateway (their machine).
//              The browser only ever holds an opaque token_ref — never the raw
//              token. Local-first (P5): no Talaria-hosted cloud.
//
// The resulting token never leaves the user's machine/gateway.

// GitHub OAuth device endpoints
const GITHUB_DEVICE_URL = "https://github.com/login/device/code";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_URL = "https://api.github.com";

// The product registers ONE GitHub OAuth App and embeds only its PUBLIC Client
// ID. No Client Secret is ever stored or shipped. Overridable per build via
// `__GITHUB_CLIENT_ID__` (Vite define) for deployments that register their own.
const DEFAULT_GITHUB_CLIENT_ID = "Iv1.0x00000000000000"; // placeholder — replace with the registered app's Client ID

export const GITHUB_CLIENT_ID: string =
  typeof __GITHUB_CLIENT_ID__ !== "undefined" && __GITHUB_CLIENT_ID__
    ? __GITHUB_CLIENT_ID__
    : DEFAULT_GITHUB_CLIENT_ID;

// Scopes requested on device flow: repo + workflow cover the M2 module needs
// (repos/PRs/CI/deploys). Fine-grained tokens carry their own scoped grants.
export const GITHUB_DEVICE_SCOPE = "repo workflow";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DeviceFlowHandle = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

export type DevicePollResult =
  | { status: "pending" }
  | { status: "success"; access_token?: string; token_ref?: string }
  | { status: "denied" }
  | { status: "expired" };

export type GitHubRequestOpts = {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string; // GitHub API path, always starts with "/"
  body?: unknown;
};

export type GitHubResponse<T> = {
  status: number;
  ok: boolean;
  data: T;
};

export type GitHubTransportKind = "direct" | "gateway";

// A transport knows HOW to reach GitHub (direct vs. through the user's
// gateway), including the device-flow exchange and token storage.
export interface GitHubTransport {
  readonly kind: GitHubTransportKind;
  startDeviceFlow(clientId: string): Promise<DeviceFlowHandle>;
  pollDeviceFlow(clientId: string, deviceCode: string): Promise<DevicePollResult>;
  request<T>(opts: GitHubRequestOpts, token?: string | null): Promise<GitHubResponse<T>>;
}

// ---------------------------------------------------------------------------
// Repo browser types (spec §5.2 — the GitHub REST payloads we map).
// ---------------------------------------------------------------------------

// GET /user/repos — an accessible repo's metadata.
export type RepoMeta = {
  id: number;
  name: string;
  full_name: string; // owner/name
  owner: { login: string };
  default_branch: string;
  private: boolean;
  description?: string | null;
  html_url: string;
};

// GET /repos/{o}/{r}/branches
export type Branch = {
  name: string;
  commit: { sha: string; url?: string };
  protected?: boolean;
};

// GET /repos/{o}/{r}/commits
export type CommitMeta = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author?: { name?: string; email?: string; date?: string } | null;
    committer?: { name?: string; date?: string } | null;
  };
  author?: { login?: string; avatar_url?: string } | null;
};

// ---------------------------------------------------------------------------
// Direct transport (desktop / Tauri) — native HTTP, no CORS.
// ---------------------------------------------------------------------------

export class DirectGitHubTransport implements GitHubTransport {
  readonly kind: "direct" = "direct";

  constructor(private fetchImpl: typeof fetch = fetch) {}

  async startDeviceFlow(clientId: string): Promise<DeviceFlowHandle> {
    const body = new URLSearchParams({
      client_id: clientId,
      scope: GITHUB_DEVICE_SCOPE,
    });
    const res = await this.fetchImpl(GITHUB_DEVICE_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new Error(`GitHub device code HTTP ${res.status}: ${await res.text().catch(() => "")}`);
    }
    const data = await res.json();
    return {
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: data.verification_uri || "https://github.com/login/device",
      expires_in: data.expires_in || 900,
      interval: data.interval || 5,
    };
  }

  async pollDeviceFlow(clientId: string, deviceCode: string): Promise<DevicePollResult> {
    const body = new URLSearchParams({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    const res = await this.fetchImpl(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (res.status === 200) {
      const data = await res.json();
      if (data.access_token) {
        return { status: "success", access_token: data.access_token };
      }
      return { status: "pending" };
    }
    const data = await res.json().catch(() => ({}));
    switch (data.error) {
      case "authorization_pending":
        return { status: "pending" };
      case "slow_down":
        return { status: "pending" };
      case "expired_token":
        return { status: "expired" };
      case "access_denied":
        return { status: "denied" };
      default:
        return { status: "denied" };
    }
  }

  async request<T>(opts: GitHubRequestOpts, token?: string | null): Promise<GitHubResponse<T>> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    const res = await this.fetchImpl(`${GITHUB_API_URL}${opts.path}`, {
      method: opts.method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let data: T;
    try {
      data = (await res.json()) as T;
    } catch {
      data = {} as T;
    }
    return { status: res.status, ok: res.ok, data };
  }
}

// ---------------------------------------------------------------------------
// Gateway transport (web / PWA) — routed through the user's own Hermes gateway.
// ---------------------------------------------------------------------------

export class GatewayGitHubTransport implements GitHubTransport {
  readonly kind: "gateway" = "gateway";

  // origin: the gateway root (e.g. http://localhost:8642 or "" for same-origin
  // via the Vite/serve proxy). apiKey: the existing API_SERVER_KEY the PWA
  // already uses for chat — the gateway's device-flow + proxy endpoints ride
  // the same trust.
  constructor(
    public origin: string,
    public apiKey: string | null,
    private fetchImpl: typeof fetch = fetch
  ) {}

  private async gatewayPost<T>(path: string, body: unknown): Promise<GitHubResponse<T>> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const res = await this.fetchImpl(`${this.origin}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T;
    return { status: res.status, ok: res.ok, data };
  }

  async startDeviceFlow(clientId: string): Promise<DeviceFlowHandle> {
    const { ok, status, data } = await this.gatewayPost<Partial<DeviceFlowHandle>>(
      "/api/v1/github/device/start",
      { clientId }
    );
    if (!ok) {
      throw new Error(`Gateway device start HTTP ${status}`);
    }
    return {
      device_code: data.device_code || "",
      user_code: data.user_code || "",
      verification_uri: data.verification_uri || "https://github.com/login/device",
      expires_in: data.expires_in || 900,
      interval: data.interval || 5,
    };
  }

  async pollDeviceFlow(clientId: string, deviceCode: string): Promise<DevicePollResult> {
    const { ok, data } = await this.gatewayPost<Record<string, string>>(
      "/api/v1/github/device/poll",
      { clientId, device_code: deviceCode }
    );
    if (!ok) return { status: "denied" };
    const st = data.status;
    if (st === "success") return { status: "success", token_ref: data.token_ref };
    if (st === "expired") return { status: "expired" };
    if (st === "denied") return { status: "denied" };
    return { status: "pending" };
  }

  async request<T>(opts: GitHubRequestOpts, _token?: string | null): Promise<GitHubResponse<T>> {
    // The gateway attaches the stored token server-side; the browser never
    // sends a raw GitHub token. The gateway validates `path` against an
    // allowlist so it stays a narrow proxy, not an open relay.
    return this.gatewayPost<T>("/api/v1/github/proxy", {
      method: opts.method,
      path: opts.path,
      body: opts.body,
    });
  }
}

// ---------------------------------------------------------------------------
// CI status types (workflow-spec §7) — checks/runs surfaced per branch and PR.
// ---------------------------------------------------------------------------

// A check run on a commit (pull-request checks / required status checks). The
// `name` is what shows up as a required-check context on a protected branch.
export type CheckRun = {
  id: number;
  name: string;
  status: CheckRunStatus; // queued | in_progress | completed | ...
  conclusion: CheckConclusion | null; // success | failure | neutral | cancelled | skipped | ...
  headSha: string;
  htmlUrl: string; // linkable back to GitHub (P3)
  appName?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
};

export type CheckRunStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "requested"
  | "waiting"
  | "pending";

export type CheckConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"
  | "stale"
  | "startup_failure";

// A GitHub Actions workflow run on a branch/ref.
export type WorkflowRun = {
  id: number;
  name: string; // workflow file name (e.g. "CI")
  displayTitle: string;
  status: "queued" | "in_progress" | "completed" | "requested" | "waiting" | "pending";
  conclusion: string | null; // success | failure | cancelled | skipped | ...
  headSha: string;
  headBranch: string;
  runNumber: number;
  event: string; // pull_request | push | workflow_dispatch | ...
  htmlUrl: string; // linkable back to GitHub (P3)
  createdAt: string;
  updatedAt: string;
};

// A `workflow_dispatch`-enabled workflow in a repo (workflow-spec §8).
// `id` is the workflow id used to dispatch; `path` is the .yml path in the repo.
export type WorkflowMeta = {
  id: number;
  name: string;
  path: string;
  state: string; // "active" | "disabled_manually" | "disabled_inactivity" | ...
  htmlUrl: string;
};

// A compact per-PR/ref checks summary used for the P1 "can merge" gate.
export type ChecksSummary = {
  total: number;
  passing: number;
  failing: number;
  pending: number; // still in_progress / queued — not yet decided
  required: Array<string>; // names of required checks
  requiredPassing: number;
  requiredTotal: number;
  canMerge: boolean; // every required check passes (P1)
  unmetRequired: Array<string>; // required checks not currently passing
};

// Determine a single per-check outcome for the summary from raw GitHub fields.
export function checkOutcome(run: Pick<CheckRun, "status" | "conclusion">): "pass" | "fail" | "pending" {
  if (run.conclusion === "success") return "pass";
  if (run.conclusion === "neutral" || run.conclusion === "skipped") return "pass";
  if (run.status === "completed") return "fail"; // completed but not success → failure
  return "pending";
}

// Build the gate summary from a set of check runs and the list of required
// check names. Pure function — easy to unit-test (P1 mirroring logic).
export function summarizeChecks(runs: Array<CheckRun>, required: Array<string>): ChecksSummary {
  const requiredSet = new Set(required);
  let passing = 0;
  let failing = 0;
  let pending = 0;
  const requiredStatus = new Map<string, "pass" | "fail" | "pending">();
  const unmetRequired: Array<string> = [];

  for (const run of runs) {
    const outcome = checkOutcome(run);
    if (outcome === "pass") passing++;
    else if (outcome === "fail") failing++;
    else pending++;
    if (requiredSet.has(run.name)) {
      requiredStatus.set(run.name, outcome);
    }
  }

  let requiredPassing = 0;
  for (const name of required) {
    const outcome = requiredStatus.get(name);
    if (outcome === "pass") {
      requiredPassing++;
    } else {
      unmetRequired.push(name);
    }
  }

  return {
    total: runs.length,
    passing,
    failing,
    pending,
    required,
    requiredPassing,
    requiredTotal: required.length,
    canMerge: required.length > 0 ? unmetRequired.length === 0 : passing === runs.length,
    unmetRequired,
  };
}

// Types for the repos / PRs / review / merge surface (M2). These mirror the
// relevant GitHub REST shapes; unknown fields are tolerated so upgrades of the
// API don't break the client (`GitHubResponse<T>` parses best-effort).
// ---------------------------------------------------------------------------

export type GitHubRepo = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  owner: { login: string };
  allow_squash_merge?: boolean;
  allow_merge_commit?: boolean;
  allow_rebase_merge?: boolean;
};

export type PullRequest = {
  number: number;
  title: string;
  user?: { login: string };
  state: string; // open | closed
  merged?: boolean;
  html_url: string;
  head: { ref: string; sha: string; repo?: { name: string; full_name: string; default_branch: string } | null };
  base: { ref: string; sha: string; repo?: { name: string; full_name: string } | null };
  created_at?: string;
  updated_at?: string;
  mergeable?: boolean | null;
  mergeable_state?: string; // clean | dirty | blocked | unknown | draft
  draft?: boolean;
  requested_reviewers?: Array<{ login: string }>;
};

export type PullRequestFile = {
  filename: string;
  status: string; // added | modified | removed | renamed | copied | changed | unchanged
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
};

export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export type PullRequestReview = {
  id: number;
  user: { login: string } | null;
  state: string; // PENDING | COMMENTED | APPROVED | CHANGES_REQUESTED | DISMISSED
  body?: string;
  submitted_at?: string;
};

export type CombinedStatus = {
  state: string; // success | failure | error | pending
  statuses: Array<{ context: string; state: string }>;
};

export type ProtectedBranch = {
  required_status_checks?: { contexts: Array<string>; strict?: boolean } | null;
  required_pull_request_reviews?: {
    required_approving_review_count?: number;
    dismiss_stale_reviews_on_push?: boolean;
  } | null;
  enforce_admins?: { enabled: boolean };
};

export type BranchProtectionResult = { status: number; data: ProtectedBranch | null };

export type MergeMethod = "squash" | "merge" | "rebase";

// Discriminated union so callers can narrow on `.merged`.
export type MergeResult =
  | { merged: true; sha: string }
  | { merged: false; status: number; message?: string; errors?: Array<{ message: string }> };

// ---------------------------------------------------------------------------
// GitHubClient — the shared service both shells use.
// ---------------------------------------------------------------------------

export class GitHubClient {
  transport: GitHubTransport;
  // The active direct token (desktop). On web the gateway holds the token and
  // we only keep an opaque tokenRef.
  token: string | null = null;
  tokenRef: string | null = null;

  constructor(transport?: GitHubTransport) {
    this.transport = transport ?? new DirectGitHubTransport();
  }

  setTransport(transport: GitHubTransport) {
    this.transport = transport;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  // Start device flow — returns a handle the UI shows (code + verification URI).
  async connectDeviceFlow(): Promise<DeviceFlowHandle> {
    return this.transport.startDeviceFlow(GITHUB_CLIENT_ID);
  }

  // Poll the device flow until the user authorizes (or the flow expires/denies).
  // Returns the raw poll result; on direct success the caller calls setToken
  // with access_token; on gateway success it records token_ref.
  async pollDeviceFlow(deviceCode: string): Promise<DevicePollResult> {
    return this.transport.pollDeviceFlow(GITHUB_CLIENT_ID, deviceCode);
  }

  // Verify the connection is live — GET /user returns the login.
  async verifyConnection(tokenOverride?: string | null): Promise<{ login: string; scopes: Array<string> }> {
    const token = tokenOverride !== undefined ? tokenOverride : this.token;
    const r = await this.transport.request<{ login?: string; message?: string }>(
      { method: "GET", path: "/user" },
      token
    );
    if (!r.ok || !r.data.login) {
      const msg = (r.data as { message?: string }).message || `HTTP ${r.status}`;
      throw new Error(msg);
    }
    return { login: r.data.login, scopes: [] };
  }

  // Generic request — used by the repos/PRs/CI/deploys modules (children).
  async request<T>(opts: GitHubRequestOpts): Promise<GitHubResponse<T>> {
    return this.transport.request<T>(opts, this.token);
  }

  // -------------------------------------------------------------------------
  // CI status (workflow-spec §7) — checks/runs per branch and PR.
  // -------------------------------------------------------------------------

  // Check runs for a commit/ref — maps a PR's headSha to its checks.
  //   GET /repos/{owner}/{repo}/commits/{sha}/check-runs
  async getCheckRuns(owner: string, repo: string, ref: string): Promise<Array<CheckRun>> {
    const r = await this.request<{
      check_runs?: Array<{
        id: number;
        name: string;
        status: CheckRunStatus;
        conclusion: CheckConclusion | null;
        head_sha?: string;
        html_url?: string;
        app?: { name?: string } | null;
        started_at?: string | null;
        completed_at?: string | null;
      }>;
    }>({ method: "GET", path: `/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}/check-runs` });
    if (!r.ok) {
      throw new Error(`Failed to load check runs: HTTP ${r.status}`);
    }
    const headSha = ref;
    return (r.data.check_runs || []).map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      conclusion: c.conclusion,
      headSha: c.head_sha || headSha,
      htmlUrl: c.html_url || `https://github.com/${owner}/${repo}/commit/${headSha}/checks`,
      appName: c.app?.name || null,
      startedAt: c.started_at ?? null,
      completedAt: c.completed_at ?? null,
    }));
  }

  // Workflow runs on a branch/ref — per-branch CI status.
  //   GET /repos/{owner}/{repo}/actions/runs?head_sha={sha}&per_page=50
  // Or by branch:   GET .../actions/runs?branch={branch}
  async getWorkflowRuns(
    owner: string,
    repo: string,
    opts: { branch?: string; headSha?: string } = {}
  ): Promise<Array<WorkflowRun>> {
    const params = new URLSearchParams({ per_page: "50" });
    if (opts.branch) params.set("branch", opts.branch);
    if (opts.headSha) params.set("head_sha", opts.headSha);
    const r = await this.request<{
      workflow_runs?: Array<{
        id: number;
        name: string;
        display_title?: string;
        status: WorkflowRun["status"];
        conclusion: string | null;
        head_sha?: string;
        head_branch?: string;
        run_number?: number;
        event?: string;
        html_url?: string;
        created_at?: string;
        updated_at?: string;
      }>;
    }>({ method: "GET", path: `/repos/${owner}/${repo}/actions/runs?${params.toString()}` });
    if (!r.ok) {
      throw new Error(`Failed to load workflow runs: HTTP ${r.status}`);
    }
    return (r.data.workflow_runs || []).map((w) => ({
      id: w.id,
      name: w.name,
      displayTitle: w.display_title || w.name,
      status: w.status,
      conclusion: w.conclusion,
      headSha: w.head_sha || opts.headSha || "",
      headBranch: w.head_branch || opts.branch || "",
      runNumber: w.run_number || 0,
      event: w.event || "",
      htmlUrl: w.html_url || `https://github.com/${owner}/${repo}/actions/runs/${w.id}`,
      createdAt: w.created_at || "",
      updatedAt: w.updated_at || "",
    }));
  }

  // Convenience: load check runs for a PR head then summarize against required
  // checks — the P1 "can merge" gate. Returns the summary + raw runs.
  async checkRunsForPr(
    owner: string,
    repo: string,
    headSha: string,
    required: Array<string>
  ): Promise<{ summary: ChecksSummary; runs: Array<CheckRun> }> {
    const runs = await this.getCheckRuns(owner, repo, headSha);
    return { summary: summarizeChecks(runs, required), runs };
  }

  // Repos / PRs / review / merge (M2). All paths are stable GitHub REST.
  // -------------------------------------------------------------------------

  async getRepo(owner: string, repo: string): Promise<GitHubRepo> {
    const r = await this.request<GitHubRepo>({ method: "GET", path: `/repos/${owner}/${repo}` });
    if (!r.ok) throw new Error((r.data as { message?: string })?.message || `HTTP ${r.status}`);
    return r.data;
  }

  // List this account's repos (owned + collaborator). `affiliation=owner,collaborator`
  // keeps the list personal (P2) rather than org-service-catalog.
  async listRepos(): Promise<Array<GitHubRepo>> {
    const r = await this.request<Array<GitHubRepo>>({
      method: "GET",
      path: `/user/repos?affiliation=owner,collaborator&sort=updated&per_page=100`,
    });
    if (!r.ok) throw new Error((r.data as { message?: string })?.message || `HTTP ${r.status}`);
    return Array.isArray(r.data) ? r.data : [];
  }

  // GET /repos/{o}/{r}/branches — branches of a repo (repo browser).
  async listBranches(owner: string, repo: string): Promise<Array<Branch>> {
    const r = await this.request<Array<Branch>>({
      method: "GET",
      path: `/repos/${owner}/${repo}/branches?per_page=100`,
    });
    if (!r.ok) {
      const msg = (r.data as unknown as { message?: string })?.message || `HTTP ${r.status}`;
      throw new Error(msg);
    }
    return r.data || [];
  }

  // GET /repos/{o}/{r}/commits?sha={branch} — recent commits on a branch.
  async listCommits(owner: string, repo: string, branch?: string): Promise<Array<CommitMeta>> {
    const sha = branch ? `&sha=${encodeURIComponent(branch)}` : "";
    const r = await this.request<Array<CommitMeta>>({
      method: "GET",
      path: `/repos/${owner}/${repo}/commits?per_page=50${sha}`,
    });
    if (!r.ok) {
      const msg = (r.data as unknown as { message?: string })?.message || `HTTP ${r.status}`;
      throw new Error(msg);
    }
    return r.data || [];
  }

  async listPullRequests(owner: string, repo: string, state: "open" | "closed" | "all" = "open"): Promise<Array<PullRequest>> {
    const r = await this.request<Array<PullRequest>>({
      method: "GET",
      path: `/repos/${owner}/${repo}/pulls?state=${state}&per_page=100`,
    });
    if (!r.ok) throw new Error((r.data as { message?: string })?.message || `HTTP ${r.status}`);
    return Array.isArray(r.data) ? r.data : [];
  }

  async getPullRequest(owner: string, repo: string, number: number): Promise<PullRequest> {
    const r = await this.request<PullRequest>({
      method: "GET",
      path: `/repos/${owner}/${repo}/pulls/${number}`,
    });
    if (!r.ok) throw new Error((r.data as { message?: string })?.message || `HTTP ${r.status}`);
    return r.data;
  }

  async getPullRequestFiles(owner: string, repo: string, number: number): Promise<Array<PullRequestFile>> {
    const r = await this.request<Array<PullRequestFile>>({
      method: "GET",
      path: `/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`,
    });
    if (!r.ok) throw new Error((r.data as { message?: string })?.message || `HTTP ${r.status}`);
    return Array.isArray(r.data) ? r.data : [];
  }

  async listReviews(owner: string, repo: string, number: number): Promise<Array<PullRequestReview>> {
    const r = await this.request<Array<PullRequestReview>>({
      method: "GET",
      path: `/repos/${owner}/${repo}/pulls/${number}/reviews`,
    });
    if (!r.ok) throw new Error((r.data as { message?: string })?.message || `HTTP ${r.status}`);
    return Array.isArray(r.data) ? r.data : [];
  }

  async submitReview(owner: string, repo: string, number: number, event: ReviewEvent, body?: string): Promise<void> {
    const r = await this.request<{ id: number }>({
      method: "POST",
      path: `/repos/${owner}/${repo}/pulls/${number}/reviews`,
      body: { event, body: body || "" },
    });
    if (!r.ok) throw new Error((r.data as { message?: string })?.message || `Review HTTP ${r.status}`);
  }

  // Branch-protection rules for a branch. Returns `{ status: 404, data: null }`
  // when the branch is UNPROTECTED — that is meaningful (P1): an unprotected
  // branch means the portal imposes no PR ceremony.
  async getBranchProtection(owner: string, repo: string, branch: string): Promise<BranchProtectionResult> {
    const r = await this.request<ProtectedBranch>({
      method: "GET",
      path: `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}/protection`,
    });
    if (r.status === 404 || r.status === 403) return { status: 404, data: null };
    if (!r.ok) return { status: r.status, data: null };
    return { status: r.status, data: r.data };
  }

  async getCommitStatus(owner: string, repo: string, sha: string): Promise<CombinedStatus> {
    const r = await this.request<CombinedStatus>({
      method: "GET",
      path: `/repos/${owner}/${repo}/commits/${sha}/status`,
    });
    if (!r.ok) throw new Error((r.data as { message?: string })?.message || `Status HTTP ${r.status}`);
    return r.data;
  }

  // PUT …/merge. GitHub enforces the repo's actual gates server-side — the
  // portal surfaces them beforehand (repo-gates) and mirrors the outcome; a
  // 405/409 here means the repo rejected the merge (mergeable_state, missing
  // review, conflict) and we surface GitHub's message verbatim (spec §11).
  async mergePullRequest(owner: string, repo: string, number: number, mergeMethod: MergeMethod): Promise<MergeResult> {
    const r = await this.request<{ merged?: boolean; sha?: string; message?: string }>({
      method: "PUT",
      path: `/repos/${owner}/${repo}/pulls/${number}/merge`,
      body: { merge_method: mergeMethod },
    });
    if (r.ok && r.data.merged) return { merged: true, sha: r.data.sha || "" };
    return {
      merged: false,
      status: r.status,
      message: (r.data as { message?: string })?.message || `Merge HTTP ${r.status}`,
      errors: ((r.data as { errors?: Array<{ message: string }> }).errors) || undefined,
    };
  }

  // -------------------------------------------------------------------------
  // Deployments (workflow-spec §8) — workflow_dispatch trigger + status watch.
  // -------------------------------------------------------------------------

  // List the `workflow_dispatch`-enabled workflows in a repo, so the UI can
  // offer only dispatchable ones (§8 Trigger). Also returns dispatchable ones
  // that are currently active (state === "active").
  //   GET /repos/{owner}/{repo}/actions/workflows?per_page=100
  async listWorkflows(owner: string, repo: string): Promise<Array<WorkflowMeta>> {
    const r = await this.request<{
      workflows?: Array<{
        id: number;
        name: string;
        path: string;
        state: string;
        html_url?: string;
      }>;
    }>({ method: "GET", path: `/repos/${owner}/${repo}/actions/workflows?per_page=100` });
    if (!r.ok) {
      throw new Error(`Failed to load workflows: HTTP ${r.status}`);
    }
    return (r.data.workflows || []).map((w) => ({
      id: w.id,
      name: w.name,
      path: w.path,
      state: w.state,
      htmlUrl: w.html_url || `https://github.com/${owner}/${repo}/actions/workflows/${w.id}`,
    }));
  }

  // Filter to workflows that can actually be dispatched: GitHub marks a
  // workflow_dispatch workflow as state "active" only when it's enabled. (A
  // workflow that lacks `on: workflow_dispatch` never appears here with active
  // state — GitHub omits it or marks it; we surface the filter and let the
  // user's selection be validated by the live API, P1.)
  listDispatchableWorkflows(workflows: Array<WorkflowMeta>): Array<WorkflowMeta> {
    return workflows.filter((w) => w.state === "active");
  }

  // Trigger a workflow_dispatch deployment.
  //   POST /repos/{owner}/{repo}/actions/workflows/{workflowId}/dispatches
  //     body: { ref, inputs }
  // Returns 204 on success (no body). Any 422 (non-dispatchable workflow / bad
  // ref) is surfaced verbatim so the UI shows GitHub's real reason (§11).
  async dispatchWorkflow(
    owner: string,
    repo: string,
    workflowId: number,
    opts: { ref: string; inputs?: Record<string, string> }
  ): Promise<void> {
    const r = await this.request<{ message?: string }>({
      method: "POST",
      path: `/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`,
      body: { ref: opts.ref, inputs: opts.inputs || {} },
    });
    if (!r.ok) {
      const msg = (r.data as { message?: string }).message || `HTTP ${r.status}`;
      throw new Error(msg);
    }
  }

  // Fetch a single workflow run by id — used to watch a dispatch reach a
  // terminal state (§8 Watch).
  //   GET /repos/{owner}/{repo}/actions/runs/{runId}
  async getWorkflowRun(owner: string, repo: string, runId: number): Promise<WorkflowRun> {
    const r = await this.request<{
      id: number;
      name: string;
      display_title?: string;
      status: WorkflowRun["status"];
      conclusion: string | null;
      head_sha?: string;
      head_branch?: string;
      run_number?: number;
      event?: string;
      html_url?: string;
      created_at?: string;
      updated_at?: string;
    }>({ method: "GET", path: `/repos/${owner}/${repo}/actions/runs/${runId}` });
    if (!r.ok) {
      throw new Error(`Failed to load workflow run: HTTP ${r.status}`);
    }
    const w = r.data;
    return {
      id: w.id,
      name: w.name,
      displayTitle: w.display_title || w.name,
      status: w.status,
      conclusion: w.conclusion,
      headSha: w.head_sha || "",
      headBranch: w.head_branch || "",
      runNumber: w.run_number || 0,
      event: w.event || "",
      htmlUrl: w.html_url || `https://github.com/${owner}/${repo}/actions/runs/${w.id}`,
      createdAt: w.created_at || "",
      updatedAt: w.updated_at || "",
    };
  }
}

export const githubClient = new GitHubClient();
