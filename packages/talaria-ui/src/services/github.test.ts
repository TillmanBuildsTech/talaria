import { describe, expect, it, vi } from "vitest";
import {
  DirectGitHubTransport,
  GatewayGitHubTransport,
  GitHubClient,
  GITHUB_CLIENT_ID,
  checkOutcome,
  summarizeChecks,
} from "./github";

// A minimal fetch mock returning a canned Response-like object.
function mockFetch(response: {
  status?: number;
  body?: unknown;
}): ReturnType<typeof vi.fn> & typeof fetch {
  return vi.fn(async () => {
    return {
      ok: (response.status ?? 200) < 400,
      status: response.status ?? 200,
      json: async () => response.body ?? {},
      text: async () => JSON.stringify(response.body ?? {}),
    } as unknown as Response;
  }) as unknown as ReturnType<typeof vi.fn> & typeof fetch;
}

function callArgs(mock: ReturnType<typeof vi.fn> & typeof fetch, i = 0): [string, RequestInit] {
  return mock.mock.calls[i] as [string, RequestInit];
}

describe("DirectGitHubTransport (desktop)", () => {
  it("starts a device flow and returns the handle", async () => {
    const fetchMock = mockFetch({
      body: {
        device_code: "dc-123",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      },
    });
    const t = new DirectGitHubTransport(fetchMock);
    const h = await t.startDeviceFlow(GITHUB_CLIENT_ID);
    expect(h.device_code).toBe("dc-123");
    expect(h.user_code).toBe("ABCD-1234");
    expect(h.interval).toBe(5);
    // The request encodes the public client id + scope, never a secret.
    const [url, init] = callArgs(fetchMock);
    expect(url).toContain("github.com/login/device/code");
    expect(String(init.body)).toContain(`client_id=${GITHUB_CLIENT_ID}`);
    expect(String(init.body)).toContain("scope=repo");
  });

  it("returns success once the user authorizes", async () => {
    const fetchMock = mockFetch({
      body: { access_token: "gho_123", token_type: "bearer", scope: "repo" },
    });
    const t = new DirectGitHubTransport(fetchMock);
    const r = await t.pollDeviceFlow(GITHUB_CLIENT_ID, "dc-123");
    expect(r.status).toBe("success");
    if (r.status === "success") expect(r.access_token).toBe("gho_123");
  });

  it("keeps polling on authorization_pending and maps denied/expired", async () => {
    const pending = new DirectGitHubTransport(mockFetch({ status: 400, body: { error: "authorization_pending" } }));
    expect((await pending.pollDeviceFlow("c", "d")).status).toBe("pending");

    const denied = new DirectGitHubTransport(mockFetch({ status: 400, body: { error: "access_denied" } }));
    expect((await denied.pollDeviceFlow("c", "d")).status).toBe("denied");

    const expired = new DirectGitHubTransport(mockFetch({ status: 400, body: { error: "expired_token" } }));
    expect((await expired.pollDeviceFlow("c", "d")).status).toBe("expired");
  });

  it("attaches the bearer token and GitHub API headers on requests", async () => {
    const fetchMock = mockFetch({ body: { login: "tillmanbuildstech" } });
    const t = new DirectGitHubTransport(fetchMock);
    const r = await t.request<{ login: string }>({ method: "GET", path: "/user" }, "gho_secret");
    expect(r.ok).toBe(true);
    expect(r.data.login).toBe("tillmanbuildstech");
    const [url, init] = callArgs(fetchMock);
    expect(url).toBe("https://api.github.com/user");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer gho_secret");
    expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });
});

describe("GatewayGitHubTransport (web / PWA)", () => {
  it("routes the device flow through the user's gateway", async () => {
    const fetchMock = mockFetch({
      body: {
        device_code: "dc-gw",
        user_code: "WXYZ-9876",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      },
    });
    const t = new GatewayGitHubTransport("http://localhost:8642", "api-key-123", fetchMock);
    const h = await t.startDeviceFlow(GITHUB_CLIENT_ID);
    expect(h.device_code).toBe("dc-gw");
    const [url, init] = callArgs(fetchMock);
    expect(url).toBe("http://localhost:8642/api/v1/github/device/start");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer api-key-123");
    expect(JSON.parse(String(init.body)).clientId).toBe(GITHUB_CLIENT_ID);
  });

  it("returns a token_ref (never a raw token) on gateway success", async () => {
    const fetchMock = mockFetch({ body: { status: "success", token_ref: "gw-ref-42" } });
    const t = new GatewayGitHubTransport("", "key", fetchMock);
    const r = await t.pollDeviceFlow(GITHUB_CLIENT_ID, "dc-gw");
    expect(r.status).toBe("success");
    if (r.status === "success") {
      expect(r.token_ref).toBe("gw-ref-42");
      expect(r.access_token).toBeUndefined();
    }
  });

  it("proxies GitHub REST through the gateway (browser never sends a raw token)", async () => {
    const fetchMock = mockFetch({ body: [{ name: "main" }] });
    const t = new GatewayGitHubTransport("http://gw:8642", "key", fetchMock);
    const r = await t.request<Array<{ name: string }>>({ method: "GET", path: "/repos/o/r/branches" });
    expect(r.data[0].name).toBe("main");
    const [url, init] = callArgs(fetchMock);
    expect(url).toBe("http://gw:8642/api/v1/github/proxy");
    const body = JSON.parse(String(init.body));
    expect(body.method).toBe("GET");
    expect(body.path).toBe("/repos/o/r/branches");
    expect(body.body).toBeUndefined();
  });
});

describe("GitHubClient", () => {
  it("verifyConnection resolves the login for a valid token", async () => {
    const t = new DirectGitHubTransport(mockFetch({ body: { login: "tillmanbuildstech" } }));
    const client = new GitHubClient(t);
    const { login } = await client.verifyConnection("gho_valid");
    expect(login).toBe("tillmanbuildstech");
  });

  it("throws on a bad/revoked token (401)", async () => {
    const t = new DirectGitHubTransport(mockFetch({ status: 401, body: { message: "Bad credentials" } }));
    const client = new GitHubClient(t);
    await expect(client.verifyConnection("gho_bad")).rejects.toThrow(/Bad credentials/);
  });

  it("selects direct by default and can switch to gateway", async () => {
    const client = new GitHubClient(new DirectGitHubTransport(mockFetch({ body: {} })));
    expect(client.transport.kind).toBe("direct");
    const gw = new GatewayGitHubTransport("", null);
    client.setTransport(gw);
    expect(client.transport.kind).toBe("gateway");
  });
});

describe("CI status — check-run gate logic (workflow-spec §7, P1)", () => {
  const check = (
    id: number,
    name: string,
    status: string,
    conclusion: string | null
  ): Parameters<typeof import("./github").checkOutcome>[0] & {
    id: number;
    name: string;
    headSha: string;
    htmlUrl: string;
  } => ({
    id,
    name,
    status: status as never,
    conclusion: conclusion as never,
    headSha: "abc123",
    htmlUrl: `https://github.com/o/r/checks/${id}`,
  });

  it("checkOutcome maps success/neutral/skipped → pass", () => {
    // imported above
    expect(checkOutcome(check(1, "CI", "completed", "success"))).toBe("pass");
    expect(checkOutcome(check(2, "CI", "completed", "neutral"))).toBe("pass");
    expect(checkOutcome(check(3, "CI", "completed", "skipped"))).toBe("pass");
  });

  it("checkOutcome maps completed-but-not-success → fail, in-flight → pending", () => {
    // imported above
    expect(checkOutcome(check(1, "CI", "completed", "failure"))).toBe("fail");
    expect(checkOutcome(check(2, "CI", "completed", "timed_out"))).toBe("fail");
    expect(checkOutcome(check(3, "CI", "in_progress", null))).toBe("pending");
    expect(checkOutcome(check(4, "CI", "queued", null))).toBe("pending");
  });

  it("summarizeChecks counts passing/failing/pending", () => {
    // imported above
    const runs = [
      check(1, "CI", "completed", "success"),
      check(2, "CodeQL", "completed", "success"),
      check(3, "Docker", "completed", "failure"),
      check(4, "Lint", "in_progress", null),
    ];
    const s = summarizeChecks(runs, []);
    expect(s.total).toBe(4);
    expect(s.passing).toBe(2);
    expect(s.failing).toBe(1);
    expect(s.pending).toBe(1);
  });

  it("P1 gate: canMerge only when all required checks pass", () => {
    // imported above
    const required = ["CI", "CodeQL"];

    // All required pass → mergeable.
    const good = summarizeChecks(
      [check(1, "CI", "completed", "success"), check(2, "CodeQL", "completed", "success"), check(3, "Lint", "completed", "failure")],
      required
    );
    expect(good.canMerge).toBe(true);
    expect(good.requiredPassing).toBe(2);
    expect(good.unmetRequired).toEqual([]);

    // A required check fails → blocked.
    const bad = summarizeChecks(
      [check(1, "CI", "completed", "success"), check(2, "CodeQL", "completed", "failure")],
      required
    );
    expect(bad.canMerge).toBe(false);
    expect(bad.unmetRequired).toEqual(["CodeQL"]);

    // A required check still running → not mergeable (pending).
    const pending = summarizeChecks(
      [check(1, "CI", "completed", "success"), check(2, "CodeQL", "in_progress", null)],
      required
    );
    expect(pending.canMerge).toBe(false);
    expect(pending.unmetRequired).toEqual(["CodeQL"]);
  });

  it("P1 gate: no required checks → mergeable when all runs pass", () => {
    // imported above
    const s = summarizeChecks([check(1, "CI", "completed", "success")], []);
    expect(s.canMerge).toBe(true);
    const withFailure = summarizeChecks([check(1, "CI", "completed", "failure")], []);
    expect(withFailure.canMerge).toBe(false);
  });

  it("getCheckRuns maps the check-runs response and hits the right endpoint", async () => {
    const fetchMock = mockFetch({
      body: {
        check_runs: [
          { id: 1, name: "CI", status: "completed", conclusion: "success", head_sha: "abc", html_url: "https://github.com/o/r/checks/1", app: { name: "GitHub Actions" } },
          { id: 2, name: "CodeQL", status: "in_progress", conclusion: null, html_url: "https://github.com/o/r/checks/2" },
        ],
      },
    });
    const client = new GitHubClient(new DirectGitHubTransport(fetchMock));
    const runs = await client.getCheckRuns("o", "r", "abc123");
    expect(runs).toHaveLength(2);
    expect(runs[0].name).toBe("CI");
    expect(runs[0].conclusion).toBe("success");
    expect(runs[0].appName).toBe("GitHub Actions");
    expect(runs[1].status).toBe("in_progress");
    const [url] = callArgs(fetchMock);
    expect(url).toBe("https://api.github.com/repos/o/r/commits/abc123/check-runs");
  });

  it("getWorkflowRuns queries by branch and maps runs", async () => {
    const fetchMock = mockFetch({
      body: {
        workflow_runs: [
          { id: 10, name: "CI", display_title: "Build & test", status: "completed", conclusion: "success", head_sha: "abc", head_branch: "main", run_number: 42, event: "push", html_url: "https://github.com/o/r/actions/runs/10" },
        ],
      },
    });
    const client = new GitHubClient(new DirectGitHubTransport(fetchMock));
    const runs = await client.getWorkflowRuns("o", "r", { branch: "main" });
    expect(runs).toHaveLength(1);
    expect(runs[0].displayTitle).toBe("Build & test");
    expect(runs[0].runNumber).toBe(42);
    expect(runs[0].event).toBe("push");
    const [url] = callArgs(fetchMock);
    expect(url).toContain("/repos/o/r/actions/runs?");
    expect(url).toContain("branch=main");
  });

  it("checkRunsForPr ties headSha → checks → gate summary", async () => {
    const fetchMock = mockFetch({
      body: {
        check_runs: [
          { id: 1, name: "CI", status: "completed", conclusion: "success" },
          { id: 2, name: "CodeQL", status: "completed", conclusion: "success" },
        ],
      },
    });
    const client = new GitHubClient(new DirectGitHubTransport(fetchMock));
    const { summary, runs } = await client.checkRunsForPr("o", "r", "headsha", ["CI", "CodeQL"]);
    expect(runs).toHaveLength(2);
    expect(summary.canMerge).toBe(true);
    expect(summary.requiredPassing).toBe(2);
  });
});

describe("GitHubClient repo browser (M2)", () => {
  const repoBody = [
    {
      id: 1,
      name: "talaria",
      full_name: "tillmanbuildstech/talaria",
      owner: { login: "tillmanbuildstech" },
      default_branch: "main",
      private: false,
      description: "Developer portal",
      html_url: "https://github.com/tillmanbuildstech/talaria",
    },
  ];

  it("listRepos returns accessible repo metadata and sets the auth token", async () => {
    const fetchMock = mockFetch({ body: repoBody });
    const client = new GitHubClient(new DirectGitHubTransport(fetchMock));
    client.setToken("gho_secret");
    const repos = await client.listRepos();
    expect(repos.length).toBe(1);
    expect(repos[0].full_name).toBe("tillmanbuildstech/talaria");
    const [url, init] = callArgs(fetchMock);
    expect(url).toContain("/user/repos");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer gho_secret");
  });

  it("listBranches hits the branches endpoint", async () => {
    const fetchMock = mockFetch({ body: [{ name: "main", commit: { sha: "abc123" } }] });
    const client = new GitHubClient(new DirectGitHubTransport(fetchMock));
    const branches = await client.listBranches("tillmanbuildstech", "talaria");
    expect(branches[0].name).toBe("main");
    const [url] = callArgs(fetchMock);
    expect(url).toBe("https://api.github.com/repos/tillmanbuildstech/talaria/branches?per_page=100");
  });

  it("listCommits scopes by branch and returns linkable commits (P3)", async () => {
    const fetchMock = mockFetch({
      body: [
        {
          sha: "abc123",
          html_url: "https://github.com/tillmanbuildstech/talaria/commit/abc123",
          commit: { message: "feat: add repo browser", author: { date: "2026-08-29T00:00:00Z" } },
        },
      ],
    });
    const client = new GitHubClient(new DirectGitHubTransport(fetchMock));
    const commits = await client.listCommits("tillmanbuildstech", "talaria", "main");
    expect(commits.length).toBe(1);
    expect(commits[0].html_url).toContain("github.com");
    const [url] = callArgs(fetchMock);
    expect(url).toContain("/repos/tillmanbuildstech/talaria/commits?per_page=50&sha=main");
  });

  it("throws a GitHub message on a non-OK listRepos response", async () => {
    const fetchMock = mockFetch({ status: 403, body: { message: "rate limit exceeded" } });
    const client = new GitHubClient(new DirectGitHubTransport(fetchMock));
    await expect(client.listRepos()).rejects.toThrow(/rate limit exceeded/);
  });
});

describe("Deployments — workflow_dispatch (workflow-spec §8)", () => {
  it("listWorkflows maps workflows and hits the actions/workflows endpoint", async () => {
    const fetchMock = mockFetch({
      body: {
        workflows: [
          { id: 1, name: "Deploy", path: ".github/workflows/deploy.yml", state: "active", html_url: "https://github.com/o/r/actions/workflows/1" },
          { id: 2, name: "Archive", path: ".github/workflows/archive.yml", state: "disabled_manually" },
        ],
      },
    });
    const client = new GitHubClient(new DirectGitHubTransport(fetchMock));
    const workflows = await client.listWorkflows("o", "r");
    expect(workflows).toHaveLength(2);
    expect(workflows[0].state).toBe("active");
    const [url] = callArgs(fetchMock);
    expect(url).toBe("https://api.github.com/repos/o/r/actions/workflows?per_page=100");
  });

  it("listDispatchableWorkflows filters to active (dispatchable) workflows only", () => {
    const client = new GitHubClient();
    const dispatchable = client.listDispatchableWorkflows([
      { id: 1, name: "Deploy", path: "d.yml", state: "active", htmlUrl: "u" },
      { id: 2, name: "Archive", path: "a.yml", state: "disabled_manually", htmlUrl: "u" },
      { id: 3, name: "Inactive", path: "i.yml", state: "disabled_inactivity", htmlUrl: "u" },
    ]);
    expect(dispatchable.map((w) => w.id)).toEqual([1]);
  });

  it("dispatchWorkflow POSTs ref + inputs to the dispatches endpoint", async () => {
    const fetchMock = mockFetch({ status: 204, body: {} });
    const client = new GitHubClient(new DirectGitHubTransport(fetchMock));
    await client.dispatchWorkflow("o", "r", 7, { ref: "main", inputs: { environment: "production" } });
    const [url, init] = callArgs(fetchMock);
    expect(url).toBe("https://api.github.com/repos/o/r/actions/workflows/7/dispatches");
    expect(JSON.parse(String(init.body))).toEqual({ ref: "main", inputs: { environment: "production" } });
  });

  it("dispatchWorkflow surfaces GitHub's 422 message verbatim (non-dispatchable / bad ref)", async () => {
    const fetchMock = mockFetch({ status: 422, body: { message: "No workflow_dispatch event in workflow file" } });
    const client = new GitHubClient(new DirectGitHubTransport(fetchMock));
    await expect(client.dispatchWorkflow("o", "r", 7, { ref: "main" })).rejects.toThrow(
      "No workflow_dispatch event in workflow file"
    );
  });

  it("getWorkflowRun maps a single run for status watch", async () => {
    const fetchMock = mockFetch({
      body: {
        id: 99,
        name: "Deploy",
        display_title: "Deploy production",
        status: "in_progress",
        conclusion: null,
        head_sha: "abc123",
        head_branch: "main",
        run_number: 7,
        event: "workflow_dispatch",
        html_url: "https://github.com/o/r/actions/runs/99",
      },
    });
    const client = new GitHubClient(new DirectGitHubTransport(fetchMock));
    const run = await client.getWorkflowRun("o", "r", 99);
    expect(run.id).toBe(99);
    expect(run.status).toBe("in_progress");
    expect(run.event).toBe("workflow_dispatch");
    expect(run.headBranch).toBe("main");
    const [url] = callArgs(fetchMock);
    expect(url).toBe("https://api.github.com/repos/o/r/actions/runs/99");
  });
});
