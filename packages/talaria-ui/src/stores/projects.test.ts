import { beforeEach, describe, expect, it } from "vitest";
import { PROJECTS_ROOT } from "../services/docs";
import { projectFolder, useProjectsStore } from "./projects";

// Reset the singleton store state between tests so assertions start clean.
beforeEach(() => {
  useProjectsStore.setState({ projects: [], activeProjectId: null, loaded: false });
});

describe("projects store", () => {
  it("starts in the global/unassigned scope", () => {
    const s = useProjectsStore.getState();
    expect(s.activeProjectId).toBeNull();
    expect(s.scopeForCreate()).toBeNull();
    expect(s.activeProject()).toBeNull();
  });

  it("creates a project, auto-assigns an opaque uuid id and a slug", async () => {
    const created = await useProjectsStore.getState().createProject({ name: "ABC Scraper" });
    expect(created.id).toBeTruthy();
    expect(created.slug).toBe("abc-scraper");
    expect(created.name).toBe("ABC Scraper");
    // id is an opaque uuid — not the slug.
    expect(created.id).not.toBe(created.slug);
    expect(useProjectsStore.getState().projects).toHaveLength(1);
  });

  it("rejects a blank project name", async () => {
    await expect(useProjectsStore.getState().createProject({ name: "   " })).rejects.toThrow();
  });

  it("scopes newly-created rows to the active project", async () => {
    const s = useProjectsStore.getState();
    const created = await s.createProject({ name: "serv" });
    await s.setActiveProject(created.id);
    expect(useProjectsStore.getState().activeProject()).toEqual(
      expect.objectContaining({ id: created.id, name: "serv" })
    );
    expect(useProjectsStore.getState().scopeForCreate()).toBe(created.id);
  });

  it("persists and restores the active scope across init", async () => {
    const s = useProjectsStore.getState();
    const created = await s.createProject({ name: "groundwork" });
    await s.setActiveProject(created.id);
    await s.init();
    expect(useProjectsStore.getState().activeProjectId).toBe(created.id);
  });

  it("switching back to global clears the active project", async () => {
    const s = useProjectsStore.getState();
    const created = await s.createProject({ name: "abc" });
    await s.setActiveProject(created.id);
    await s.setActiveProject(null);
    expect(useProjectsStore.getState().activeProjectId).toBeNull();
    expect(useProjectsStore.getState().scopeForCreate()).toBeNull();
  });

  it("deleting the active project falls back to the global scope", async () => {
    const s = useProjectsStore.getState();
    const created = await s.createProject({ name: "abc" });
    await s.setActiveProject(created.id);
    await s.deleteProject(created.id);
    expect(useProjectsStore.getState().activeProjectId).toBeNull();
    expect(useProjectsStore.getState().projects).toHaveLength(0);
  });

  it("ignores setActiveProject for an unknown id (scope guard)", async () => {
    const s = useProjectsStore.getState();
    await s.setActiveProject("does-not-exist");
    expect(s.activeProjectId).toBeNull();
  });

  it("ties a project to its server folder by default (P9)", async () => {
    const created = await useProjectsStore.getState().createProject({ name: "ABC Scraper" });
    expect(created.folder).toBe(`${PROJECTS_ROOT}/abc-scraper`);
    expect(projectFolder("abc-scraper")).toBe(`${PROJECTS_ROOT}/abc-scraper`);
  });

  it("allows an explicit folder override on create", async () => {
    const created = await useProjectsStore.getState().createProject({
      name: "serv",
      folder: `${PROJECTS_ROOT}/custom-serv`,
    });
    expect(created.folder).toBe(`${PROJECTS_ROOT}/custom-serv`);
  });

  it("updates the folder via updateProject", async () => {
    const created = await useProjectsStore.getState().createProject({ name: "abc" });
    await useProjectsStore.getState().updateProject(created.id, {
      folder: `${PROJECTS_ROOT}/moved`,
    });
    const updated = useProjectsStore.getState().projects.find((p) => p.id === created.id);
    expect(updated?.folder).toBe(`${PROJECTS_ROOT}/moved`);
  });
});
