// Capability abstraction for the M3 code editor (architecture.md
// "Desktop-only capabilities"). The editor is desktop-only: on the Tauri
// shell the shared module renders a real editor; on web it degrades to a
// clear "desktop-only" affordance instead of breaking (P6 — one shared brain,
// both shells; desktop may layer desktop-only extras, never a fork).
//
// The UI never checks `navigator`/`__TAURI_INTERNALS__` directly for the
// editor. It asks the capability registry "is the code editor available in
// this shell?" and renders the affordance or the editor accordingly. The
// shell (or tests) registers the concrete backend, so web and desktop both
// mount the identical shared module and only the backend differs.

export type EditorPlatform = "desktop" | "web";

// A single file open in the editor. `sha` is the blob sha the content was read
// from; passing it back on save avoids a stale-write 409 on the Contents API.
export type EditorTarget = {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  sha?: string | null;
};

export type EditorDocument = {
  target: EditorTarget;
  content: string;
  sha: string;
};

export type EditorSaveResult = {
  sha: string;
  branch: string;
  htmlUrl?: string;
};

// The backend an editor module talks to. Desktop provides a real
// implementation (GitHub Contents/git-trees via the shared GitHub client);
// web provides an unavailable one that reports `available: false` so the UI
// renders the affordance without ever invoking file IO.
export interface CodeEditorBackend {
  readonly platform: EditorPlatform;
  readonly available: boolean;
  /** List the files (blobs) on a branch, for the file browser. */
  listFiles(owner: string, repo: string, branch: string): Promise<Array<{ path: string; size?: number }>>;
  /** Read a file's content on a branch. */
  openFile(target: EditorTarget): Promise<EditorDocument>;
  /** Save edited content back to a branch (creates a commit on that branch). */
  saveToBranch(target: EditorTarget, content: string, message: string): Promise<EditorSaveResult>;
}

const DESKTOP_ONLY_MSG =
  "The code editor is a desktop-only capability. Open Talaria's desktop app to view and edit code.";

// Web backend — present but not available, so the shared editor module renders
// a desktop-only affordance and never attempts file IO.
export class DesktopOnlyEditorBackend implements CodeEditorBackend {
  readonly platform: EditorPlatform = "web";
  readonly available = false;

  async listFiles(): Promise<Array<{ path: string; size?: number }>> {
    throw new Error(DESKTOP_ONLY_MSG);
  }
  async openFile(): Promise<EditorDocument> {
    throw new Error(DESKTOP_ONLY_MSG);
  }
  async saveToBranch(): Promise<EditorSaveResult> {
    throw new Error(DESKTOP_ONLY_MSG);
  }
}

let backend: CodeEditorBackend = new DesktopOnlyEditorBackend();

/** Register the concrete editor backend for this shell (desktop). */
export function setEditorBackend(b: CodeEditorBackend): void {
  backend = b;
}

/** The currently active editor backend. */
export function getEditorBackend(): CodeEditorBackend {
  return backend;
}

/** Convenience flag the UI reads to pick editor-vs-affordance. */
export function isEditorAvailable(): boolean {
  return backend.available;
}
