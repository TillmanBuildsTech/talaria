import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectPicker } from "./project-picker";
import { ProjectSettingsDialog } from "./project-settings-dialog";
import { useProjectsStore } from "../stores/projects";

// Reset the singleton store state between tests so assertions start clean.
beforeEach(() => {
  useProjectsStore.setState({ projects: [], activeProjectId: null, loaded: false });
});

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
});
