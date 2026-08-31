import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectPicker } from "./project-picker";
import { ProjectSettingsDialog } from "./project-settings-dialog";
import { useProjectsStore } from "../stores/projects";
import { useReposStore } from "../stores/repos";
import { githubClient } from "../services/github";
import db from "../db";
import { PROJECTS_ROOT } from "../services/docs";

// Reset the singleton store state between tests so assertions start clean.
beforeEach(() => {
  useProjectsStore.setState({ projects: [], activeProjectId: null, loaded: false });
  useReposStore.getState().reset();
  vi.restoreAllMocks();
  return db.projects.clear();
});

// A connected repo the settings dialog can attach to a project.
async function seedRepos() {
  const listReposSpy = vi.spyOn(githubClient, "listRepos").mockResolvedValue([
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
  ] as never);
  await useReposStore.getState().loadRepos(null);
  return listReposSpy;
}

describe("ProjectPicker — project settings gear (UI task t_ba6da6df)", () => {
  it("hides the gear button when the global/unassigned scope is active", () => {
    render(<ProjectPicker />);
    expect(screen.queryByRole("button", { name: "Project settings" })).not.toBeInTheDocument();
  });

  it("shows the gear button beside the picker once a real project is selected", async () => {
    const created = await useProjectsStore.getState().createProject({ name: "ABC Scraper" });
    await useProjectsStore.getState().setActiveProject(created.id);
    render(<ProjectPicker />);
    expect(screen.getByRole("button", { name: "Project settings" })).toBeInTheDocument();
  });

  it("opens the project settings dialog from the gear button", async () => {
    const created = await useProjectsStore.getState().createProject({ name: "ABC Scraper" });
    await useProjectsStore.getState().setActiveProject(created.id);
    render(<ProjectPicker />);
    fireEvent.click(screen.getByRole("button", { name: "Project settings" }));
    expect(screen.getByRole("heading", { name: "Project settings" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("ABC Scraper")).toBeInTheDocument();
  });
});

describe("ProjectSettingsDialog", () => {
  it("pre-fills the form from the project and saves edits via updateProject", async () => {
    const created = await useProjectsStore.getState().createProject({
      name: "serv",
      description: "Go service manager",
      color: "#38bdf8",
    });
    const onClose = vi.fn();
    render(<ProjectSettingsDialog project={created} onClose={onClose} />);

    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    expect(nameInput.value).toBe("serv");
    expect(screen.getByLabelText("Description")).toHaveValue("Go service manager");

    fireEvent.change(nameInput, { target: { value: "serv v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    const updated = useProjectsStore.getState().projects.find((p) => p.id === created.id);
    expect(updated?.name).toBe("serv v2");
  });

  it("deletes the project after confirmation", async () => {
    const created = await useProjectsStore.getState().createProject({ name: "doomed" });
    const onClose = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<ProjectSettingsDialog project={created} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useProjectsStore.getState().projects.some((p) => p.id === created.id)).toBe(false);
    confirmSpy.mockRestore();
  });

  it("keeps the project when deletion is cancelled", async () => {
    const created = await useProjectsStore.getState().createProject({ name: "safe" });
    const onClose = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<ProjectSettingsDialog project={created} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));

    expect(useProjectsStore.getState().projects.some((p) => p.id === created.id)).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("pre-fills the server folder from the project and saves it", async () => {
    const created = await useProjectsStore.getState().createProject({ name: "serv" });
    const onClose = vi.fn();
    render(<ProjectSettingsDialog project={created} onClose={onClose} />);

    const folderInput = screen.getByLabelText("Server folder") as HTMLInputElement;
    expect(folderInput.value).toBe(`${PROJECTS_ROOT}/serv`);

    fireEvent.change(folderInput, { target: { value: `${PROJECTS_ROOT}/serv-work` } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    const updated = useProjectsStore.getState().projects.find((p) => p.id === created.id);
    expect(updated?.folder).toBe(`${PROJECTS_ROOT}/serv-work`);
  });

  it("attaches and detaches a repo to/from the project (P9 repo association)", async () => {
    await seedRepos();
    const created = await useProjectsStore.getState().createProject({ name: "serv" });
    const onClose = vi.fn();

    render(<ProjectSettingsDialog project={created} onClose={onClose} />);

    // Both seeded repos render; neither is attached yet.
    await waitFor(() => expect(screen.getByText("tillmanbuildstech/talaria")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: "Attach" }).length).toBe(2);

    // Attach the talaria repo to this project.
    const talariaRow = screen.getByText("tillmanbuildstech/talaria").closest("div") as HTMLElement;
    fireEvent.click(talariaRow.querySelector('button[type="button"]') as HTMLElement);

    await waitFor(() =>
      expect(useReposStore.getState().repos.find((r) => r.fullName === "tillmanbuildstech/talaria")?.project).toBe(created.id)
    );
  });
});
