// M3 code editor store — drives the desktop-only editor module in @talaria/ui.
// Talks to the shared GitHub client (Contents / git-trees API) through the
// editor capability backend registered for the shell. When the backend is
// unavailable (web), the UI renders a desktop-only affordance and never calls
// these actions.
import { create } from "zustand";
import {
  getEditorBackend,
  isEditorAvailable,
  type EditorTarget,
} from "../services/editor-capability";

export type EditorState = {
  available: boolean;
  files: Array<{ path: string; size?: number }>;
  doc: EditorTarget | null;
  content: string;
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  savedMessage: string | null;

  refresh: () => void;
  listFiles: (owner: string, repo: string, branch: string) => Promise<void>;
  openFile: (target: EditorTarget) => Promise<void>;
  setContent: (content: string) => void;
  save: (message?: string) => Promise<void>;
  close: () => void;
  reset: () => void;
};

function defaultMessage(doc: EditorTarget | null): string {
  return doc ? `Edit ${doc.path}` : "Save changes";
}

export const useEditorStore = create<EditorState>((set, get) => ({
  available: isEditorAvailable(),
  files: [],
  doc: null,
  content: "",
  dirty: false,
  loading: false,
  saving: false,
  error: null,
  savedMessage: null,

  refresh() {
    set({ available: isEditorAvailable() });
  },

  async listFiles(owner, repo, branch) {
    const backend = getEditorBackend();
    if (!backend.available) return;
    set({ loading: true, error: null, savedMessage: null });
    try {
      const files = await backend.listFiles(owner, repo, branch);
      set({ files, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : "Could not list files" });
    }
  },

  async openFile(target) {
    const backend = getEditorBackend();
    if (!backend.available) return;
    set({ loading: true, error: null, savedMessage: null });
    try {
      const doc = await backend.openFile(target);
      set({
        doc: doc.target,
        content: doc.content,
        dirty: false,
        loading: false,
      });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : "Could not open file" });
    }
  },

  setContent(content) {
    const { doc, content: prev } = get();
    if (!doc) return;
    set({ content, dirty: content !== prev });
  },

  async save(message) {
    const { doc, content } = get();
    const backend = getEditorBackend();
    if (!doc || !backend.available) return;
    set({ saving: true, error: null, savedMessage: null });
    try {
      const msg = message || defaultMessage(doc);
      const res = await backend.saveToBranch(doc, content, msg);
      set({
        saving: false,
        dirty: false,
        savedMessage: `Saved ${doc.path} → ${res.branch}`,
        doc: { ...doc, sha: res.sha },
      });
    } catch (err) {
      set({ saving: false, error: err instanceof Error ? err.message : "Could not save file" });
    }
  },

  close() {
    set({ doc: null, content: "", dirty: false, files: [], error: null, savedMessage: null });
  },

  reset() {
    set({ available: isEditorAvailable(), files: [], doc: null, content: "", dirty: false, loading: false, saving: false, error: null, savedMessage: null });
  },
}));
