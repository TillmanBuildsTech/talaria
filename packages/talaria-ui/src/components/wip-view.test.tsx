import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { githubClient } from "../services/github";
import { useGitHubStore } from "../stores/github";
import { useReposStore } from "../stores/repos";
import { usePrsStore } from "../stores/prs";
import { useProjectsStore } from "../stores/projects";
import { NavRail } from "./nav-rail";
import { WipView } from "./wip-view";

// WIP view combines the former Repos + Pull Requests modules. Tests cover the
// spec §4 acceptance criteria: nav entry, repo+PR rendering, count chips,
// filter + "open PRs only" toggle, and empty states.
const listReposSpy = vi.spyOn(githubClient, "listRepos");
const listPullRequestsSpy = vi.spyOn(githubClient, "listPullRequests");
const listBranchesSpy = vi.spyOn(githubClient, "listBranches");
const listCommitsSpy = vi.spyOn(githubClient, "listCommits");

const CONN = {
  id: "tillmanbuildstech",
  owner: "tillmanbuildstech",
  type: "device",
  status: "connected",
  scopes: ["repo"],
  tokenRef: "gw-ref-test",
  gatewayOrigin: "",
  lastVerifiedAt: 0,
  connectedAt: 0,
} as const;

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

beforeEach(() => {
  listReposSpy.mockReset();
  listPullRequestsSpy.mockReset();
  listBranchesSpy.mockReset();
  listCommitsSpy.mockReset();
  useReposStore.getState().reset();
  usePrsStore.setState({
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
  });
  useGitHubStore.setState({ connections: [CONN] as never });
  useProjectsStore.setState({ projects: [], activeProjectId: null, loaded: false } as never);
});

describe("NavRail — single WIP entry (AC1)", () => {
  it("renders exactly one WIP entry and no Repos / Pull Requests entries", () => {
    render(<NavRail active="wip" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "WIP" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Repos" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pull Requests" })).not.toBeInTheDocument();
    // Exactly one nav entry labeled WIP.
    expect(screen.getAllByRole("button", { name: "WIP" })).toHaveLength(1);
  });

  it("selects the wip module on click and styles it active", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<NavRail active="chat" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "WIP" }));
    expect(onSelect).toHaveBeenCalledWith("wip");
    rerender(<NavRail active="wip" onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: "WIP" })).toHaveAttribute("aria-current", "page");
  });
});

describe("WipView — combined repo + PR rendering (AC2, AC4, AC8)", () => {
  it("shows repos with open-PR count chips once counts load", async () => {
    listReposSpy.mockResolvedValue(REPOS as never);
    listPullRequestsSpy.mockImplementation(async (owner, repo) => {
      if (owner === "tillmanbuildstech" && repo === "talaria") {
        return [
          { number: 2, title: "Second PR", user: { login: "brandon" }, head: { ref: "a" }, base: { ref: "main" }, state: "open", draft: false, html_url: "https://github.com/tillmanbuildstech/talaria/pull/2" },
          { number: 1, title: "First PR", user: { login: "brandon" }, head: { ref: "b" }, base: { ref: "main" }, state: "open", draft: true, html_url: "https://github.com/tillmanbuildstech/talaria/pull/1" },
        ] as never;
      }
      return [];
    });

    render(<WipView />);

    expect(await screen.findByText("tillmanbuildstech/talaria")).toBeInTheDocument();
    expect(screen.getByText("tillmanbuildstech/serv")).toBeInTheDocument();

    // talaria has 2 open PRs → amber chip; serv has 0 → no chip.
    await waitFor(() => expect(screen.getByText("2 PRs")).toBeInTheDocument());
    expect(screen.queryByText("1 PRs")).not.toBeInTheDocument();
    expect(screen.queryByText("0 PRs")).not.toBeInTheDocument();
  });

  it("expanding a repo reveals nested PRs (newest first) plus branch/commit explorer", async () => {
    listReposSpy.mockResolvedValue(REPOS as never);
    listPullRequestsSpy.mockImplementation(async (owner, repo) => {
      if (owner === "tillmanbuildstech" && repo === "talaria") {
        return [
          { number: 2, title: "Newer PR", user: { login: "brandon" }, head: { ref: "a" }, base: { ref: "main" }, state: "open", draft: false, html_url: "https://github.com/tillmanbuildstech/talaria/pull/2" },
          { number: 1, title: "Older PR", user: { login: "brandon" }, head: { ref: "b" }, base: { ref: "main" }, state: "open", draft: true, html_url: "https://github.com/tillmanbuildstech/talaria/pull/1" },
        ] as never;
      }
      return [];
    });
    listBranchesSpy.mockResolvedValue([{ name: "main", commit: { sha: "abc" } }] as never);
    listCommitsSpy.mockResolvedValue([
      { sha: "abc123", html_url: "https://github.com/tillmanbuildstech/talaria/commit/abc123", commit: { message: "feat: wip", author: { date: "2026-08-29T00:00:00Z" } } },
    ] as never);

    render(<WipView />);

    const row = (await screen.findByText("tillmanbuildstech/talaria")).closest("li");
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLElement).getByRole("button"));

    // Nested PR section shows both PRs, newest first.
    expect(await screen.findByText("Newer PR")).toBeInTheDocument();
    expect(screen.getByText("Older PR")).toBeInTheDocument();
    expect(screen.getByText(/draft/)).toBeInTheDocument();
    // Branch selector + commits also render (async after expand).
    expect(await screen.findByText("main")).toBeInTheDocument();
    expect(await screen.findByText("feat: wip")).toBeInTheDocument();
  });

  it("filters repos by name and via the 'open PRs only' toggle", async () => {
    listReposSpy.mockResolvedValue(REPOS as never);
    listPullRequestsSpy.mockImplementation(async (owner, repo) => {
      if (owner === "tillmanbuildstech" && repo === "talaria") {
        return [{ number: 1, title: "Solo PR", user: { login: "brandon" }, head: { ref: "a" }, base: { ref: "main" }, state: "open", draft: false, html_url: "https://github.com/tillmanbuildstech/talaria/pull/1" }] as never;
      }
      return [];
    });

    render(<WipView />);

    await screen.findByText("tillmanbuildstech/talaria");
    await waitFor(() => expect(screen.getByText("1 PR")).toBeInTheDocument());

    // Text filter narrows to one repo.
    fireEvent.change(screen.getByLabelText("Filter repos"), { target: { value: "serv" } });
    expect(screen.queryByText("tillmanbuildstech/talaria")).not.toBeInTheDocument();
    expect(screen.getByText("tillmanbuildstech/serv")).toBeInTheDocument();

    // Clear filter, then "open PRs only" hides repos with no open PRs.
    fireEvent.change(screen.getByLabelText("Filter repos"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Open PRs only/ }));
    expect(screen.getByText("tillmanbuildstech/talaria")).toBeInTheDocument();
    expect(screen.queryByText("tillmanbuildstech/serv")).not.toBeInTheDocument();
  });

  it("renders the connect affordance when GitHub is not connected (AC7 #1)", () => {
    useGitHubStore.setState({ connections: [] as never });
    render(<WipView />);
    expect(screen.getByText("Connect GitHub to browse your repos.")).toBeInTheDocument();
  });

  it("renders 'No repos match.' when the filter matches nothing (AC7 #4)", async () => {
    listReposSpy.mockResolvedValue(REPOS as never);
    listPullRequestsSpy.mockResolvedValue([] as never);
    render(<WipView />);
    await screen.findByText("tillmanbuildstech/talaria");
    fireEvent.change(screen.getByLabelText("Filter repos"), { target: { value: "zzz-none" } });
    expect(screen.getByText("No repos match.")).toBeInTheDocument();
  });

  it("renders 'No accessible repos.' when the repos list is empty (AC7 #2)", async () => {
    listReposSpy.mockResolvedValue([] as never);
    listPullRequestsSpy.mockResolvedValue([] as never);
    render(<WipView />);
    expect(await screen.findByText("No accessible repos.")).toBeInTheDocument();
    expect(screen.queryByText("No accessible repos for this project scope.")).not.toBeInTheDocument();
  });

  it("renders the project-scoped empty state when a project is active (AC7 #2)", async () => {
    listReposSpy.mockResolvedValue([] as never);
    listPullRequestsSpy.mockResolvedValue([] as never);
    useProjectsStore.setState({ projects: [{ id: "p1", name: "Scraper" }] as never, activeProjectId: "p1" });
    render(<WipView />);
    expect(await screen.findByText("No accessible repos for this project scope.")).toBeInTheDocument();
  });

  it("renders 'No open pull requests.' for an expanded repo with none (AC7 #3)", async () => {
    listReposSpy.mockResolvedValue(REPOS as never);
    listPullRequestsSpy.mockResolvedValue([] as never);
    render(<WipView />);
    const row = (await screen.findByText("tillmanbuildstech/talaria")).closest("li");
    fireEvent.click(within(row as HTMLElement).getByRole("button"));
    expect(await screen.findByText("No open pull requests.")).toBeInTheDocument();
  });

  it("Refresh re-fetches repos and open-PR counts for every repo (AC4)", async () => {
    let talariaCalls = 0;
    listReposSpy.mockResolvedValue(REPOS as never);
    listPullRequestsSpy.mockImplementation(async (owner, repo) => {
      if (owner === "tillmanbuildstech" && repo === "talaria") {
        talariaCalls += 1;
        return [
          { number: 1, title: "Refreshed PR", user: { login: "brandon" }, head: { ref: "a" }, base: { ref: "main" }, state: "open", draft: false, html_url: "https://github.com/tillmanbuildstech/talaria/pull/1" },
        ] as never;
      }
      return [];
    });

    render(<WipView />);
    await screen.findByText("tillmanbuildstech/talaria");
    await waitFor(() => expect(screen.getByText("1 PR")).toBeInTheDocument());
    expect(talariaCalls).toBe(1);

    // Baseline repo reloads on mount: init()→refreshRepos and the loadRepos
    // effect both hit listRepos. Record the count before pressing Refresh.
    const reposBefore = listReposSpy.mock.calls.length;

    // Press Refresh → repo list reloads AND every repo's open-PR count is
    // re-fetched (listPullRequests fires again), not just re-read from cache.
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(listReposSpy.mock.calls.length).toBe(reposBefore + 1));
    await waitFor(() => expect(talariaCalls).toBe(2));
    // Count chip still rendered after refresh.
    expect(await screen.findByText("1 PR")).toBeInTheDocument();
  });

  it("Refresh is disabled while a refresh is in flight (AC4)", async () => {
    listReposSpy.mockResolvedValue(REPOS as never);
    listPullRequestsSpy.mockResolvedValue([] as never);

    render(<WipView />);
    await screen.findByText("tillmanbuildstech/talaria");

    const refreshBtn = screen.getByRole("button", { name: "Refresh" });
    fireEvent.click(refreshBtn);
    // setRefreshing(true) runs synchronously before loadRepos awaits, so the
    // button is disabled as soon as the click is processed.
    expect(refreshBtn).toBeDisabled();

    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh" })).not.toBeDisabled());
  });
});
