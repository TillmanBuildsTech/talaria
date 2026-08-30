import { describe, expect, it, vi } from "vitest";
import { DirectGitHubTransport, GitHubClient } from "./github";

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

const repoMeta = {
  id: 1,
  name: "serv",
  full_name: "TillmanBuildsTech/serv",
  default_branch: "main",
  private: false,
  html_url: "https://github.com/TillmanBuildsTech/serv",
  owner: { login: "TillmanBuildsTech" },
  allow_squash_merge: true,
  allow_merge_commit: false,
  allow_rebase_merge: false,
};

describe("GitHubClient PR surface (M2)", () => {
  it("listRepos queries the personal repo list", async () => {
    const fetchMock = mockFetch({ body: [repoMeta] });
    const client = new GitHubClient(new DirectGitHubTransport(fetchMock));
    const repos = await client.listRepos();
    expect(repos[0].full_name).toBe("TillmanBuildsTech/serv");
    const [url] = callArgs(fetchMock);
    expect(url).toContain("/user/repos?");
    expect(url).toContain("affiliation=owner,collaborator");
  });

  it("listPullRequests asks for open PRs", async () => {
    const fetchMock = mockFetch({
      body: [{ number: 10, title: "Fix", state: "open", head: { ref: "f", sha: "a" }, base: { ref: "main", sha: "b" } }],
    });
    const client = new GitHubClient(new DirectGitHubTransport(fetchMock));
    const prs = await client.listPullRequests("TillmanBuildsTech", "serv", "open");
    expect(prs[0].number).toBe(10);
    const [url] = callArgs(fetchMock);
    expect(url).toBe("https://api.github.com/repos/TillmanBuildsTech/serv/pulls?state=open&per_page=100");
  });

  it("getPullRequestFiles returns the diff patch set", async () => {
    const fetchMock = mockFetch({ body: [{ filename: "src/a.ts", status: "modified", additions: 2, deletions: 1, patch: "@@ -1 +1 @@\n-x\n+x" }] });
    const client = new GitHubClient(new DirectGitHubTransport(fetchMock));
    const files = await client.getPullRequestFiles("o", "r", 10);
    expect(files[0].filename).toBe("src/a.ts");
    expect(files[0].patch).toContain("+x");
  });

  it("submitReview POSTs the review event with a body", async () => {
    const fetchMock = mockFetch({ body: { id: 5, state: "APPROVED" } });
    const client = new GitHubClient(new DirectGitHubTransport(fetchMock));
    await client.submitReview("o", "r", 10, "APPROVE", "looks good");
    const [url, init] = callArgs(fetchMock);
    expect(url).toBe("https://api.github.com/repos/o/r/pulls/10/reviews");
    expect(JSON.parse(String(init.body))).toEqual({ event: "APPROVE", body: "looks good" });
  });

  it("submitReview throws when GitHub rejects it", async () => {
    const fetchMock = mockFetch({ status: 422, body: { message: "Can't approve your own PR" } });
    const client = new GitHubClient(new DirectGitHubTransport(fetchMock));
    await expect(client.submitReview("o", "r", 10, "APPROVE")).rejects.toThrow("Can't approve your own PR");
  });

  it("getBranchProtection returns 404 as unprotected (meaningful, P1)", async () => {
    const fetchMock = mockFetch({ status: 404, body: { message: "Branch not protected" } });
    const client = new GitHubClient(new DirectGitHubTransport(fetchMock));
    const res = await client.getBranchProtection("o", "r", "main");
    expect(res.status).toBe(404);
    expect(res.data).toBeNull();
  });

  it("getBranchProtection returns the rules for a protected branch", async () => {
    const rules = { required_status_checks: { contexts: ["ci"] }, required_pull_request_reviews: { required_approving_review_count: 1 } };
    const fetchMock = mockFetch({ body: rules });
    const client = new GitHubClient(new DirectGitHubTransport(fetchMock));
    const res = await client.getBranchProtection("o", "r", "main");
    expect(res.status).toBe(200);
    expect(res.data?.required_status_checks?.contexts).toEqual(["ci"]);
    const [url] = callArgs(fetchMock);
    expect(url).toContain("/branches/main/protection");
  });

  it("getCommitStatus maps the combined status", async () => {
    const fetchMock = mockFetch({ body: { state: "success", statuses: [{ context: "ci", state: "success" }] } });
    const client = new GitHubClient(new DirectGitHubTransport(fetchMock));
    const s = await client.getCommitStatus("o", "r", "abc123");
    expect(s.state).toBe("success");
    expect(s.statuses[0].context).toBe("ci");
  });

  it("mergePullRequest sends the chosen merge_method and reports success", async () => {
    const fetchMock = mockFetch({ status: 200, body: { merged: true, sha: "DEADBEEF" } });
    const client = new GitHubClient(new DirectGitHubTransport(fetchMock));
    const res = await client.mergePullRequest("o", "r", 10, "squash");
    expect(res).toEqual({ merged: true, sha: "DEADBEEF" });
    const [url, init] = callArgs(fetchMock);
    expect(url).toBe("https://api.github.com/repos/o/r/pulls/10/merge");
    expect(JSON.parse(String(init.body))).toEqual({ merge_method: "squash" });
  });

  it("mergePullRequest surfaces GitHub's refusal verbatim (405/409/422)", async () => {
    const fetchMock = mockFetch({ status: 405, body: { message: "Merge commits are not allowed" } });
    const client = new GitHubClient(new DirectGitHubTransport(fetchMock));
    const res = await client.mergePullRequest("o", "r", 10, "merge");
    if (res.merged) {
      throw new Error("expected a refusal");
    }
    expect(res.status).toBe(405);
    expect(res.message).toBe("Merge commits are not allowed");
  });
});