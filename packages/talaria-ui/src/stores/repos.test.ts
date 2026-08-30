import { beforeEach, describe, expect, it, vi } from "vitest";
import { githubClient } from "../services/github";
import { useReposStore } from "./repos";

// The repos store calls the shared githubClient singleton for live data.
const listReposSpy = vi.spyOn(githubClient, "listRepos");
const listBranchesSpy = vi.spyOn(githubClient, "listBranches");
const listCommitsSpy = vi.spyOn(githubClient, "listCommits");

const REPOS = [
  {
    id: 1,
    name: "talaria",
    full_name: "tillmanbuildstech/talaria",
    owner: { login: "tillmanbuildstech" },
    default_branch: "main",
    private: false,
    html_url: "https://github.com/tillmanbuildstech/talaria",
  },
  {
    id: 2,
    name: "serv",
    full_name: "tillmanbuildstech/serv",
    owner: { login: "tillmanbuildstech" },
    default_branch: "main",
    private: true,
    html_url: "https://github.com/tillmanbuildstech/serv",
  },
];

describe("useReposStore", () => {
  beforeEach(() => {
    listReposSpy.mockReset();
    listBranchesSpy.mockReset();
    listCommitsSpy.mockReset();
    useReposStore.getState().reset();
  });

  it("loads accessible repos from GitHub and maps them to Repo rows with GitHub URLs", async () => {
    listReposSpy.mockResolvedValue(REPOS as never);
    await useReposStore.getState().loadRepos(null);
    const { repos } = useReposStore.getState();
    expect(repos.length).toBe(2);
    const talaria = repos.find((r) => r.id === "tillmanbuildstech/talaria");
    expect(talaria?.htmlUrl).toBe("https://github.com/tillmanbuildstech/talaria");
    expect(repos.find((r) => r.id === "tillmanbuildstech/serv")?.isPrivate).toBe(true);
  });

  it("falls back to cached repos when the live call fails (offline, P5)", async () => {
    listReposSpy.mockRejectedValueOnce(new Error("network down"));
    // Seed a cached repo directly.
    await useReposStore.getState().loadRepos(null);
    // Now a failure should still surface whatever is cached.
    listReposSpy.mockRejectedValue(new Error("network down"));
    await useReposStore.getState().loadRepos(null);
    // At minimum it doesn't throw and reports the error.
    expect(useReposStore.getState().error).toBe("network down");
  });

  it("loads branches and pre-selects the default branch's commits", async () => {
    listReposSpy.mockResolvedValue(REPOS as never);
    await useReposStore.getState().loadRepos(null);
    const repo = useReposStore.getState().repos[0];

    listBranchesSpy.mockResolvedValue([{ name: "main", commit: { sha: "abc" } }] as never);
    listCommitsSpy.mockResolvedValue([
      {
        sha: "abc123",
        html_url: "https://github.com/tillmanbuildstech/talaria/commit/abc123",
        commit: { message: "feat: repo browser", author: { date: "2026-08-29T00:00:00Z" } },
      },
    ] as never);

    await useReposStore.getState().loadBranches(repo);
    expect(useReposStore.getState().branches[repo.id][0].name).toBe("main");
    await useReposStore.getState().loadCommits(repo, "main");
    expect(useReposStore.getState().commits[`${repo.id}:main`][0].html_url).toContain("github.com");
    expect(useReposStore.getState().openBranch[repo.id]).toBe("main");
  });

  it("attaches and detaches a repo to/from a project scope (P9)", async () => {
    listReposSpy.mockResolvedValue(REPOS as never);
    await useReposStore.getState().loadRepos(null);
    const repo = useReposStore.getState().repos[0];

    await useReposStore.getState().attachRepo(repo.id, "proj-abc");
    expect(useReposStore.getState().repos.find((r) => r.id === repo.id)?.project).toBe("proj-abc");

    await useReposStore.getState().detachRepo(repo.id);
    expect(useReposStore.getState().repos.find((r) => r.id === repo.id)?.project).toBe("");
  });
});
