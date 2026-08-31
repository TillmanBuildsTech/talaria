import { describe, expect, it } from "vitest";
import {
  FilesystemDocsTransport,
  docsDir,
  docsFilePath,
  isGitRoot,
  normalizeDocName,
  PROJECTS_ROOT,
  type DocsFileSystem,
} from "./docs";

describe("docs path helpers", () => {
  it("builds the per-project docs dir under the Hermes server root", () => {
    expect(PROJECTS_ROOT).toBe("~/.hermes/projects");
    expect(docsDir("abc-scraper")).toBe("~/.hermes/projects/abc-scraper/docs");
  });

  it("joins a doc path into a full server path", () => {
    expect(docsFilePath("serv", "plan.md")).toBe("~/.hermes/projects/serv/docs/plan.md");
  });
});

describe("normalizeDocName", () => {
  it("slugs a title and forces the .md extension", () => {
    expect(normalizeDocName("My Design Notes")).toBe("my-design-notes.md");
    expect(normalizeDocName("Scraper Architecture")).toBe("scraper-architecture.md");
  });

  it("handles an existing .md extension", () => {
    expect(normalizeDocName("Plan.md")).toBe("plan.md");
  });

  it("falls back for empty / blank input", () => {
    expect(normalizeDocName("   ")).toBe("doc.md");
    expect(normalizeDocName("")).toBe("doc.md");
  });

  it("strips path separators so names cannot escape the docs dir", () => {
    expect(normalizeDocName("../../evil")).toBe("evil.md");
    expect(normalizeDocName("a/b/c")).toBe("a-b-c.md");
  });
});

describe("FilesystemDocsTransport", () => {
  // A tiny in-memory filesystem for deterministic tests.
  function memoryFs(): DocsFileSystem & { store: Map<string, string> } {
    const store = new Map<string, string>();
    const fs: DocsFileSystem = {
      async readFile(path) {
        const v = store.get(path);
        if (v === undefined) throw new Error(`ENOENT: ${path}`);
        return v;
      },
      async writeFile(path, content) {
        store.set(path, content);
      },
      async removeFile(path) {
        store.delete(path);
      },
      async listDir(path) {
        const entries: Array<{ name: string; isDir: boolean }> = [];
        for (const key of store.keys()) {
          if (key.startsWith(`${path}/`)) {
            entries.push({ name: key.slice(path.length + 1), isDir: false });
          }
        }
        return entries;
      },
    };
    return { ...fs, store };
  }

  it("lists markdown docs for a project's docs dir", async () => {
    const fs = memoryFs();
    const t = new FilesystemDocsTransport(fs);
    fs.store.set("~/.hermes/projects/abc/docs/plan.md", "# Plan");
    fs.store.set("~/.hermes/projects/abc/docs/adr-1.md", "# ADR");
    // A non-.md file is ignored.
    fs.store.set("~/.hermes/projects/abc/docs/notes.txt", "nope");

    const docs = await t.list("abc");
    expect(docs.map((d) => d.name).sort()).toEqual(["adr-1.md", "plan.md"]);
  });

  it("returns an empty list when the docs dir does not exist", async () => {
    const fs = memoryFs();
    const t = new FilesystemDocsTransport(fs);
    expect(await t.list("empty-project")).toEqual([]);
  });

  it("round-trips write → read on the server path", async () => {
    const fs = memoryFs();
    const t = new FilesystemDocsTransport(fs);
    await t.write("serv", "roadmap.md", "# Roadmap");
    expect(await t.read("serv", "roadmap.md")).toEqual({
      name: "roadmap.md",
      path: "roadmap.md",
      content: "# Roadmap",
    });
    expect(fs.store.has("~/.hermes/projects/serv/docs/roadmap.md")).toBe(true);
  });

  it("removes a doc", async () => {
    const fs = memoryFs();
    const t = new FilesystemDocsTransport(fs);
    await t.write("serv", "old.md", "x");
    await t.remove("serv", "old.md");
    expect(await t.list("serv")).toEqual([]);
  });
});

describe("git detection", () => {
  // A fake host filesystem modeling directory structure (isDir + subdir
  // contents) so we can probe listDirectory's per-subdir .git peek.
  function dirFs(): DocsFileSystem & { dirs: Map<string, Array<{ name: string; isDir: boolean }>> } {
    const dirs = new Map<string, Array<{ name: string; isDir: boolean }>>();
    const fs: DocsFileSystem = {
      async readFile(path) {
        throw new Error(`readFile not expected: ${path}`);
      },
      async writeFile() {
        throw new Error("writeFile not expected");
      },
      async removeFile() {
        throw new Error("removeFile not expected");
      },
      async listDir(path) {
        const entries = dirs.get(path);
        if (!entries) throw new Error(`ENOENT: ${path}`);
        return entries;
      },
    };
    return { ...fs, dirs };
  }

  it("isGitRoot is false without a .git entry and true with one", () => {
    expect(isGitRoot([{ name: "src", isDir: true }])).toBe(false);
    expect(isGitRoot([{ name: "src", isDir: true }, { name: ".git", isDir: true }])).toBe(true);
    // A .git file (worktree/submodule) also counts.
    expect(isGitRoot([{ name: ".git", isDir: false }])).toBe(true);
  });

  it("listDirectory flags a non-git folder's subdirs as isGitRepo:false", async () => {
    const fs = dirFs();
    const t = new FilesystemDocsTransport(fs);
    fs.dirs.set("~/.hermes/projects", [
      { name: "plain", isDir: true },
      { name: "notes.txt", isDir: false },
    ]);
    fs.dirs.set("~/.hermes/projects/plain", [{ name: "src", isDir: true }]);

    const listing = await t.listDirectory("~/.hermes/projects");
    const plain = listing.entries.find((e) => e.name === "plain");
    expect(plain?.isDir).toBe(true);
    expect(plain?.isGitRepo).toBe(false);
    // Non-directory entries carry no git flag.
    expect(listing.entries.find((e) => e.name === "notes.txt")?.isGitRepo).toBeUndefined();
  });

  it("listDirectory flags a git folder's subdirs as isGitRepo:true", async () => {
    const fs = dirFs();
    const t = new FilesystemDocsTransport(fs);
    fs.dirs.set("~/.hermes/projects", [
      { name: "repo-a", isDir: true },
      { name: "worktree-b", isDir: true },
    ]);
    fs.dirs.set("~/.hermes/projects/repo-a", [
      { name: ".git", isDir: true },
      { name: "src", isDir: true },
    ]);
    fs.dirs.set("~/.hermes/projects/worktree-b", [
      { name: ".git", isDir: false },
    ]);

    const listing = await t.listDirectory("~/.hermes/projects");
    expect(listing.entries.find((e) => e.name === "repo-a")?.isGitRepo).toBe(true);
    expect(listing.entries.find((e) => e.name === "worktree-b")?.isGitRepo).toBe(true);
  });

  it("listDirectory tolerates a subdir whose contents can't be read (treats as non-git)", async () => {
    const fs = dirFs();
    const t = new FilesystemDocsTransport(fs);
    fs.dirs.set("~/.hermes/projects", [{ name: "locked", isDir: true }]);
    // 'locked' has no listing — the peek throws, and it must degrade to false.

    const listing = await t.listDirectory("~/.hermes/projects");
    expect(listing.entries.find((e) => e.name === "locked")?.isGitRepo).toBe(false);
  });
});
