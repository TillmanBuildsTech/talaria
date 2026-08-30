// Docs store (M1 item 3) — per-project markdown documentation.
//
// A project's Docs section is a set of markdown files written and edited
// inside Talaria. They are stored on the Hermes server (P10) at
//   ~/.hermes/projects/<slug>/docs/*.md  — OUTSIDE the repo — so agents can
// read them as context when working in that project (projects.md), and so
// they never get conflated with the product's own `apps/docs`.
//
// Scoping (P9): the docs you see and edit are scoped to the ACTIVE project.
// The global/unassigned scope has no docs directory (docs are per-project by
// definition). Switching projects swaps the loaded doc set.
//
// Transport (P6): selected at init like the github store — desktop (Tauri)
// uses the native filesystem; web/PWA routes through the user's gateway.
// Both read/write the same server directory.
import { create } from "zustand";
import {
  createDesktopTransport,
  docsClient,
  type ProjectDoc,
  type ProjectDocMeta,
} from "../services/docs";

// Detect the desktop (Tauri) shell at runtime, same as the github store.
function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type DocsState = {
  // The active project's docs (list metadata). Reloaded on scope switch.
  docs: Array<ProjectDocMeta>;
  // The doc currently open in the editor, with its content loaded.
  activeDoc: ProjectDoc | null;
  // In-progress editor text (unsaved). Saved via save().
  draft: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
  platform: "desktop" | "web";

  init: () => Promise<void>;
  // Load the given project's doc list into state. Called on scope switch.
  loadForProject: (projectSlug: string | null) => Promise<void>;
  // Open a doc and load its content into the editor.
  openDoc: (projectSlug: string, path: string) => Promise<void>;
  // Update the in-progress draft without saving.
  setDraft: (text: string) => void;
  // Save the current draft back to the doc.
  save: (projectSlug: string) => Promise<void>;
  // Create a new empty doc in the project's docs dir.
  createDoc: (projectSlug: string, name: string) => Promise<void>;
  // Delete a doc.
  deleteDoc: (projectSlug: string, path: string) => Promise<void>;
  reset: () => void;
};

export const useDocsStore = create<DocsState>((set, get) => ({
  docs: [],
  activeDoc: null,
  draft: "",
  loading: false,
  saving: false,
  error: null,
  platform: isDesktop() ? "desktop" : "web",

  async init() {
    // Configure the transport for this shell (P6). Desktop uses the native
    // filesystem when the shell has injected an adapter (see
    // configureDocsFileSystem); otherwise — and always on web — it falls back
    // to the gateway transport, which reaches the same server directory.
    if (get().platform === "desktop") {
      docsClient.setTransport(createDesktopTransport());
    }
    // Web keeps the default gateway transport from the service.
  },

  async loadForProject(projectSlug) {
    if (!projectSlug) {
      // Global/unassigned scope has no docs (P9): docs are per-project.
      set({ docs: [], activeDoc: null, draft: "", error: null });
      return;
    }
    set({ loading: true, error: null });
    try {
      const docs = await docsClient.list(projectSlug);
      set({ docs, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : "Could not load project docs" });
    }
  },

  async openDoc(projectSlug, path) {
    set({ loading: true, error: null });
    try {
      const doc = await docsClient.read(projectSlug, path);
      set({ activeDoc: doc, draft: doc.content, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : "Could not open doc" });
    }
  },

  setDraft(text) {
    set({ draft: text });
  },

  async save(projectSlug) {
    const { activeDoc, draft } = get();
    if (!activeDoc || !projectSlug) return;
    set({ saving: true, error: null });
    try {
      await docsClient.write(projectSlug, activeDoc.path, draft);
      set({
        saving: false,
        activeDoc: { ...activeDoc, content: draft },
      });
      await get().loadForProject(projectSlug);
    } catch (err) {
      set({ saving: false, error: err instanceof Error ? err.message : "Could not save doc" });
    }
  },

  async createDoc(projectSlug, name) {
    set({ saving: true, error: null });
    try {
      await docsClient.write(projectSlug, name, "");
      set({ saving: false });
      await get().loadForProject(projectSlug);
    } catch (err) {
      set({ saving: false, error: err instanceof Error ? err.message : "Could not create doc" });
    }
  },

  async deleteDoc(projectSlug, path) {
    set({ saving: true, error: null });
    try {
      await docsClient.remove(projectSlug, path);
      set({ saving: false });
      if (get().activeDoc?.path === path) {
        set({ activeDoc: null, draft: "" });
      }
      await get().loadForProject(projectSlug);
    } catch (err) {
      set({ saving: false, error: err instanceof Error ? err.message : "Could not delete doc" });
    }
  },

  reset() {
    set({ docs: [], activeDoc: null, draft: "", loading: false, saving: false, error: null });
  },
}));
