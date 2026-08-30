// Concrete code-editor backend for the desktop (Tauri) shell (M3). It rides
// the shared GitHub client's transport abstraction (DirectGitHubTransport on
// desktop) against the Contents / git-trees API: list a branch's files, read a
// file's content, and save edits back to a branch. Desktop-only — registered
// into the capability registry when running in the Tauri shell; web keeps the
// default unavailable backend and renders the desktop-only affordance.
import { githubClient } from "./github";
import {
  setEditorBackend,
  type CodeEditorBackend,
  type EditorDocument,
  type EditorPlatform,
  type EditorSaveResult,
  type EditorTarget,
} from "./editor-capability";

// Detect the desktop (Tauri) shell at runtime — same probe the GitHub auth
// store uses (__TAURI_INTERNALS__ is injected by the Tauri webview).
function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export class GitHubEditorBackend implements CodeEditorBackend {
  readonly platform: EditorPlatform = "desktop";
  readonly available = true;

  async listFiles(owner: string, repo: string, branch: string): Promise<Array<{ path: string; size?: number }>> {
    const nodes = await githubClient.listFiles(owner, repo, branch);
    return nodes.map((n) => ({ path: n.path, size: n.size }));
  }

  async openFile(target: EditorTarget): Promise<EditorDocument> {
    const { content, sha } = await githubClient.getFileContent(target.owner, target.repo, target.branch, target.path);
    return { target: { ...target, sha }, content, sha };
  }

  async saveToBranch(target: EditorTarget, content: string, message: string): Promise<EditorSaveResult> {
    const res = await githubClient.saveFileToBranch(
      target.owner,
      target.repo,
      target.branch,
      target.path,
      content,
      message,
      target.sha ?? undefined
    );
    return { sha: res.commit.sha, branch: target.branch, htmlUrl: res.commit.html_url };
  }
}

// Register the desktop editor backend when running in the Tauri shell. Web
// leaves the registry at its default unavailable backend (desktop-only
// affordance). Safe to call repeatedly; idempotent.
export function registerEditorBackendForPlatform(): void {
  if (isDesktop()) {
    setEditorBackend(new GitHubEditorBackend());
  }
}
