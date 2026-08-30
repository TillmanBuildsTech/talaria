import { describe, expect, it, afterEach, vi } from "vitest";
import { useEditorStore } from "./editor";
import { setEditorBackend, type CodeEditorBackend } from "../services/editor-capability";

// A controllable in-memory backend so the store is tested without network.
function fakeBackend(overrides: Partial<CodeEditorBackend> = {}): CodeEditorBackend {
  return {
    platform: "desktop",
    available: true,
    listFiles: vi.fn(async () => [{ path: "src/a.ts", size: 3 }, { path: "README.md", size: 4 }]),
    openFile: vi.fn(async ({ path }) => ({
      target: { owner: "o", repo: "r", branch: "main", path, sha: "blob-1" },
      content: "const a = 1;\n",
      sha: "blob-1",
    })),
    saveToBranch: vi.fn(async (_target, _content, _message) => ({
      sha: "commit-9",
      branch: "main",
      htmlUrl: `https://github.com/o/r/commit/commit-9`,
    })),
    ...overrides,
  } as CodeEditorBackend;
}

afterEach(() => {
  useEditorStore.getState().reset();
  // Restore the default web backend.
  setEditorBackend({ platform: "web", available: false } as CodeEditorBackend);
});

describe("editor store (M3)", () => {
  it("opens a file and marks the document dirty on content change", async () => {
    setEditorBackend(fakeBackend());
    useEditorStore.getState().refresh();
    await useEditorStore.getState().openFile({ owner: "o", repo: "r", branch: "main", path: "src/a.ts" });

    const s = useEditorStore.getState();
    expect(s.doc?.path).toBe("src/a.ts");
    expect(s.content).toBe("const a = 1;\n");
    expect(s.dirty).toBe(false);

    useEditorStore.getState().setContent("const a = 2;\n");
    expect(useEditorStore.getState().dirty).toBe(true);
  });

  it("saves edited content to a branch and clears the dirty flag", async () => {
    const backend = fakeBackend();
    setEditorBackend(backend);
    useEditorStore.getState().refresh();
    await useEditorStore.getState().openFile({ owner: "o", repo: "r", branch: "main", path: "src/a.ts" });
    useEditorStore.getState().setContent("const a = 99;\n");

    await useEditorStore.getState().save("Fix constant");
    const s = useEditorStore.getState();
    expect(s.dirty).toBe(false);
    expect(s.savedMessage).toContain("src/a.ts");
    expect(s.doc?.sha).toBe("commit-9");
    const saveMock = backend.saveToBranch as ReturnType<typeof vi.fn>;
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: "src/a.ts", sha: "blob-1" }),
      "const a = 99;\n",
      "Fix constant"
    );
  });

  it("lists files for the file browser", async () => {
    setEditorBackend(fakeBackend());
    useEditorStore.getState().refresh();
    await useEditorStore.getState().listFiles("o", "r", "main");
    expect(useEditorStore.getState().files.map((f) => f.path)).toEqual(["src/a.ts", "README.md"]);
  });

  it("no-ops when the backend is unavailable (web — affordance path)", async () => {
    setEditorBackend({ platform: "web", available: false } as CodeEditorBackend);
    useEditorStore.getState().refresh();
    expect(useEditorStore.getState().available).toBe(false);
    await useEditorStore.getState().openFile({ owner: "o", repo: "r", branch: "main", path: "a.ts" });
    expect(useEditorStore.getState().doc).toBeNull();
  });

  it("surfaces a save error without clearing the dirty content", async () => {
    setEditorBackend(
      fakeBackend({
        saveToBranch: vi.fn(async () => {
          throw new Error("409: sha mismatch");
        }),
      })
    );
    useEditorStore.getState().refresh();
    await useEditorStore.getState().openFile({ owner: "o", repo: "r", branch: "main", path: "src/a.ts" });
    useEditorStore.getState().setContent("edited");
    await useEditorStore.getState().save("msg");
    expect(useEditorStore.getState().error).toContain("409");
    expect(useEditorStore.getState().dirty).toBe(true);
  });
});
