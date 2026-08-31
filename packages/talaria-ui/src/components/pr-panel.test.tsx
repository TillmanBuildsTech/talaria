import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { githubClient } from "../services/github";
import { useProjectsStore } from "../stores/projects";
import { useReposStore } from "../stores/repos";
import { usePrsStore } from "../stores/prs";
import { PrPanel } from "./pr-panel";

// PrPanel project-scoping (P9): when a project is active, the PRs module must
// scope to that project's ATTACHED repo (mirroring the Deployments module),
// and show an explanatory notice when the project has no attached repo.
// Global/unassigned scope keeps the user's last-picked repo.
describe("PrPanel — project scoping (P9)", () => {
  beforeEach(() => {
    // PrPanel.init() → refreshRepos() hits the live GitHub API; stub it so the
    // render is deterministic and offline.
    vi.spyOn(githubClient, "listRepos").mockResolvedValue([] as never);
    usePrsStore.setState({
      repos: [],
      activeFullName: null,
      detail: null,
      loadingRepos: false,
    });
    useReposStore.setState({ repos: [] });
    useProjectsStore.setState({ activeProjectId: null });
  });

  it("shows an attach-repo notice when a project is active but no repo is attached", () => {
    useProjectsStore.setState({ activeProjectId: "proj-a" });
    useReposStore.setState({ repos: [] });
    usePrsStore.setState({ repos: [], activeFullName: null, detail: null });

    render(<PrPanel />);
    // Main pane: no attached repo → explanatory notice, not a PR list.
    expect(screen.getByText(/No repository is attached to this project/i)).toBeTruthy();
    expect(screen.queryByText(/Select a repository on the left/i)).toBeNull();
  });

  it("scopes to the active project's attached repo instead of the global selection", () => {
    useProjectsStore.setState({ activeProjectId: "proj-a" });
    // Project A is attached to repo "org/a"; global selection pointed at "org/z".
    useReposStore.setState({
      repos: [
        {
          id: "org/a",
          owner: "org",
          name: "a",
          fullName: "org/a",
          defaultBranch: "main",
          isPrivate: false,
          htmlUrl: "https://github.com/org/a",
          project: "proj-a",
          lastFetchedAt: Date.now(),
        },
      ],
    });
    usePrsStore.setState({
      repos: [
        { fullName: "org/a", name: "a", owner: "org", defaultBranch: "main", htmlUrl: "x", allowSquashMerge: true, allowMergeCommit: false, allowRebaseMerge: false, updatedAt: 0 },
        { fullName: "org/z", name: "z", owner: "org", defaultBranch: "main", htmlUrl: "z", allowSquashMerge: true, allowMergeCommit: false, allowRebaseMerge: false, updatedAt: 0 },
      ],
      activeFullName: "org/z",
      detail: null,
    });

    render(<PrPanel />);
    // The picker only lists the project-attached repo — the globally-persisted
    // selection (org/z) is scoped out entirely.
    expect(screen.queryByText("org/z")).toBeNull();
    // The attached repo is listed (picker span) and drives the PR list.
    expect(screen.getAllByText("org/a").length).toBeGreaterThanOrEqual(1);
    // No "select a repo" prompt when scoped to a real attached repo.
    expect(screen.queryByText(/Select a repository on the left/i)).toBeNull();
  });
});
