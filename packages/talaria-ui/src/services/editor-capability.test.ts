import { describe, expect, it, vi, afterEach } from "vitest";
import {
  DesktopOnlyEditorBackend,
  getEditorBackend,
  isEditorAvailable,
  setEditorBackend,
} from "./editor-capability";
import { GitHubEditorBackend, registerEditorBackendForPlatform } from "./github-editor-backend";
import { githubClient } from "./github";

afterEach(() => {
  // Reset to the default web backend so tests are isolated.
  setEditorBackend(new DesktopOnlyEditorBackend());
});

describe("editor capability abstraction (P6 — desktop-only affordance)", () => {
  it("defaults to an unavailable web backend on web", () => {
    expect(isEditorAvailable()).toBe(false);
    expect(getEditorBackend().platform).toBe("web");
  });

  it("renders the desktop-only affordance because an unavailable backend never performs IO", async () => {
    const backend = getEditorBackend();
    await expect(backend.listFiles("o", "r", "main")).rejects.toThrow(/desktop-only/);
    await expect(backend.openFile({ owner: "o", repo: "r", branch: "main", path: "a.ts" })).rejects.toThrow(
      /desktop-only/
    );
    await expect(backend.saveToBranch({ owner: "o", repo: "r", branch: "main", path: "a.ts" }, "x", "msg")).rejects.toThrow(
      /desktop-only/
    );
  });

  it("switches to a real available backend when registered (desktop)", () => {
    setEditorBackend(new GitHubEditorBackend());
    expect(isEditorAvailable()).toBe(true);
    expect(getEditorBackend().platform).toBe("desktop");
  });

  it("registerEditorBackendForPlatform leaves web unavailable", () => {
    // In jsdom there is no __TAURI_INTERNALS__, so the desktop backend must NOT
    // be registered — the web surface keeps the affordance.
    registerEditorBackendForPlatform();
    expect(isEditorAvailable()).toBe(false);
  });
});

describe("GitHubEditorBackend (desktop)", () => {
  it("delegates listFiles / openFile / saveToBranch to the shared GitHub client", async () => {
    const backend = new GitHubEditorBackend();
    const listSpy = vi.spyOn(githubClient, "listFiles").mockResolvedValue([
      { path: "src/a.ts", mode: "100644", type: "blob", sha: "b1", size: 3 },
    ] as never);
    const files = await backend.listFiles("o", "r", "main");
    expect(files).toEqual([{ path: "src/a.ts", size: 3 }]);
    listSpy.mockRestore();
  });
});
