import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useProjectsStore } from "../stores/projects";
import { GitRepoNotice } from "./git-repo-notice";

// Reset the singleton store so each case starts in a clean scope.
beforeEach(() => {
  useProjectsStore.setState({ projects: [], activeProjectId: null, loaded: false });
});

async function seedProject(overrides: { isGitRepo?: boolean } = {}) {
  const created = await useProjectsStore.getState().createProject({
    name: "abc",
    ...(overrides.isGitRepo !== undefined ? { isGitRepo: overrides.isGitRepo } : {}),
  });
  await useProjectsStore.getState().setActiveProject(created.id);
}

describe("GitRepoNotice", () => {
  it("renders nothing in the global/unassigned scope", async () => {
    const { container } = render(<GitRepoNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the active project's folder IS a git repo", async () => {
    await seedProject({ isGitRepo: true });
    const { container } = render(<GitRepoNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the explanatory notice when the active project is not a git repo", async () => {
    await seedProject({ isGitRepo: false });
    render(<GitRepoNotice />);
    expect(
      screen.getByText(/not a git repository/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/feature requires a git repository/i)).toBeInTheDocument();
    expect(screen.getByText(/abc/)).toBeInTheDocument();
  });
});
