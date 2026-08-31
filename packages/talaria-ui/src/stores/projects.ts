// Projects store — the top-level organizing namespace (P9).
//
// Each Project is a self-contained workspace. A reserved global/unassigned
// scope (activeProjectId === null) holds anything not bound to a project
// (one-off questions). Switching the active project swaps the whole view and
// data namespace: scoped stores (chat, and later kanban/observability) read
// `activeProjectId` at their boundary and filter/tag rows by it.
//
// Persistence: projects live in the Dexie `projects` table (local-first, P5).
// The active selection is persisted in settings so it survives reloads.
import { create } from "zustand";
import db, { type Project } from "../db";

const SETTING_ACTIVE_PROJECT = "activeProjectId";

// Stable colors for auto-assigned project accents (cycled round-robin).
// Exported so the settings dialog offers the same palette for manual picks.
export const PROJECT_COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#60a5fa"];

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}

function newId(): string {
  // Opaque UUID (crypto.randomUUID when available; fallback for non-secure ctxs).
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export type ProjectInput = {
  name: string;
  slug?: string;
  description?: string;
  color?: string;
};

export type ProjectsState = {
  projects: Array<Project>;
  activeProjectId: string | null; // null = global / unassigned scope
  loaded: boolean;

  init: () => Promise<void>;
  loadProjects: () => Promise<void>;
  createProject: (input: ProjectInput) => Promise<Project>;
  updateProject: (id: string, patch: Partial<Pick<Project, "name" | "slug" | "description" | "color">>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  setActiveProject: (id: string | null) => Promise<void>;
  // ── scope helpers (used by scoped stores at their boundary) ────────────
  activeProject: () => Project | null;
  // Tag applied to newly-created scoped rows: active project id, or null for
  // the global/unassigned scope.
  scopeForCreate: () => string | null;
};

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  loaded: false,

  async init() {
    // Restore the persisted active scope, then load projects.
    const saved = await db.settings.get(SETTING_ACTIVE_PROJECT);
    if (saved?.value) {
      // Persist active scope may reference a now-deleted project — fall back
      // to global in that case (validated in loadProjects via setActiveProject).
      set({ activeProjectId: saved.value });
    }
    await get().loadProjects();
    set({ loaded: true });
  },

  async loadProjects() {
    const projects = await db.projects.orderBy("createdAt").toArray();
    set({ projects });
    // If the active scope points at a project that no longer exists, reset to
    // the global scope.
    const { activeProjectId } = get();
    if (activeProjectId && !projects.some((p) => p.id === activeProjectId)) {
      set({ activeProjectId: null });
      await db.settings.put({ key: SETTING_ACTIVE_PROJECT, value: "" });
    }
  },

  async createProject({ name, slug, description, color }) {
    const trimmed = (name || "").trim();
    if (!trimmed) throw new Error("Project name is required");
    const project: Project = {
      id: newId(),
      slug: slugify(slug || trimmed),
      name: trimmed,
      description,
      color: color || PROJECT_COLORS[get().projects.length % PROJECT_COLORS.length],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.projects.add(project);
    await get().loadProjects();
    return project;
  },

  async updateProject(id, patch) {
    const project = await db.projects.get(id);
    if (!project) return;
    const next = {
      ...(patch.name != null ? { name: patch.name, slug: slugify(patch.slug || patch.name) } : {}),
      ...(patch.slug != null && patch.name == null ? { slug: slugify(patch.slug) } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      updatedAt: Date.now(),
    };
    await db.projects.update(id, next);
    await get().loadProjects();
  },

  // The global/unassigned scope is reserved and non-deletable (it has no table
  // row). Deleting a project also resets the active scope if it was active.
  async deleteProject(id) {
    await db.projects.delete(id);
    const { activeProjectId } = get();
    if (activeProjectId === id) {
      set({ activeProjectId: null });
      await db.settings.put({ key: SETTING_ACTIVE_PROJECT, value: "" });
    }
    await get().loadProjects();
  },

  // Switch the active scope. Switching swaps the whole view/data namespace
  // (P9): scoped stores re-query against the new scope on their next load.
  async setActiveProject(id) {
    // null → global scope; a real id must exist in the table.
    if (id !== null && !get().projects.some((p) => p.id === id)) return;
    set({ activeProjectId: id });
    await db.settings.put({ key: SETTING_ACTIVE_PROJECT, value: id ?? "" });
  },

  activeProject() {
    const { projects, activeProjectId } = get();
    if (!activeProjectId) return null;
    return projects.find((p) => p.id === activeProjectId) || null;
  },

  scopeForCreate() {
    return get().activeProjectId;
  },
}));
