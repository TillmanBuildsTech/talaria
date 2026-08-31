import { describe, expect, it } from "vitest";
import {
  FilesystemDocsTransport,
  GatewayDocsTransport,
  docsDir,
  docsFilePath,
  isGitRoot,
  normalizeDocName,
  normalizeHostDir,
  PROJECTS_ROOT,
  type DocsFileSystem,
  type HostDirEntry,
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

describe("normalizeHostDir", () => {
  it("collapses duplicate slashes and strips a trailing slash", () => {
    expect(normalizeHostDir("~//.hermes//projects/")).toBe("~/.hermes/projects");
    expect(normalizeHostDir("/root/proj//sub/")).toBe("/root/proj/sub");
  });

  it("rejects empty and path-traversal input", () => {
    expect(normalizeHostDir("")).toBeNull();
    expect(normalizeHostDir("~/../etc")).toBeNull();
    expect(normalizeHostDir("../up")).toBeNull();
    expect(normalizeHostDir("/root/../..")).toBeNull();
  });

  it("accepts a plain relative or absolute host path", () => {
    expect(normalizeHostDir("~/.hermes/projects")).toBe("~/.hermes/projects");
    expect(normalizeHostDir("/srv/app")).toBe("/srv/app");
  });
});

describe("isGitRoot", () => {
  it("flags a .git directory entry as a git repo root", () => {
    const entries: Array<HostDirEntry> = [
      { name: "src", isDir: true },
      { name: ".git", isDir: true },
    ];
    expect(isGitRoot(entries)).toBe(true);
  });

  it("flags a .git file (worktree/submodule) as a git repo root", () => {
    const entries: Array<HostDirEntry> = [{ name: ".git", isDir: false }];
    expect(isGitRoot(entries)).toBe(true);
  });

  it("returns false when no .git entry exists", () => {
    const entries: Array<HostDirEntry> = [
      { name: "src", isDir: true },
      { name: "README.md", isDir: false },
    ];
    expect(isGitRoot(entries)).toBe(false);
  });
});

describe("FilesystemDocsTransport.listDirectory", () => {
  // A tiny in-memory filesystem with directory awareness for the picker test.
  // Files are keyed by full path; directories are derived from the path tree.
  function treeFs(): DocsFileSystem & { store: Map<string, string> } {
    const store = new Map<string, string>();
    const dirsOf = (path: string): Array<{ name: string; isDir: boolean }> => {
      const prefix = path === "/" ? "/" : `${path}/`;
      const names = new Set<string>();
      for (const key of store.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (!rest) continue;
        const first = rest.split("/")[0];
        names.add(first);
      }
      const entries: Array<{ name: string; isDir: boolean }> = [];
      // Directories are the ones that prefix longer keys; files are leaf keys.
      for (const name of names) {
        const childPrefix = `${prefix}${name}/`;
        const hasChildren = [...store.keys()].some((k) => k.startsWith(childPrefix));
        entries.push({ name, isDir: hasChildren });
      }
      return entries;
    };
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
        const entries = dirsOf(path);
        if (entries.length === 0) throw new Error(`ENOENT: ${path}`);
        return entries;
      },
    };
    return { ...fs, store };
  }

  it("lists directory entries with git detection on subdirectories", async () => {
    const fs = treeFs();
    const t = new FilesystemDocsTransport(fs);
    // Files mark the tree: ~/.hermes/projects/{repo-a,repo-b,plain}/...
    fs.store.set("~/.hermes/projects/README.md", "# projects");
    fs.store.set("~/.hermes/projects/repo-a/.git/HEAD", "ref: refs/heads/main");
    fs.store.set("~/.hermes/projects/repo-a/README.md", "# a");
    fs.store.set("~/.hermes/projects/repo-b/.git/config", "[core]");
    fs.store.set("~/.hermes/projects/plain/notes.txt", "nope");

    const listing = await t.listDirectory("~/.hermes/projects");
    expect(listing.path).toBe("~/.hermes/projects");

    const byName = new Map(listing.entries.map((e) => [e.name, e]));
    expect(byName.get("repo-a")).toEqual({ name: "repo-a", isDir: true, isGitRepo: true });
    expect(byName.get("repo-b")).toEqual({ name: "repo-b", isDir: true, isGitRepo: true });
    // A directory with no .git is not a git repo root.
    expect(byName.get("plain")).toEqual({ name: "plain", isDir: true, isGitRepo: false });
    // A top-level file is not a directory and carries no git flag.
    expect(byName.get("README.md")).toEqual({ name: "README.md", isDir: false });
  });

  it("rejects when the directory does not exist (picker surfaces the error)", async () => {
    const fs = treeFs();
    const t = new FilesystemDocsTransport(fs);
    // No keys exist under the target → the fs adapter throws ENOENT, and the
    // transport lets it propagate so the FolderPicker shows an error state.
    await expect(t.listDirectory("~/.hermes/projects")).rejects.toThrow("ENOENT");
  });
});

describe("GatewayDocsTransport.listDirectory", () => {
  it("requests the host/directory endpoint and parses the listing", async () => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method || "GET", headers: (init?.headers as Record<string, string>) ?? {} });
      const body = JSON.stringify({
        path: "~/.hermes/projects",
        entries: [
          { name: "repo-a", isDir: true, isGitRepo: true },
          { name: "plain", isDir: true, isGitRepo: false },
          { name: "file.txt", isDir: false },
        ],
      });
      return { ok: true, status: 200, json: async () => JSON.parse(body) } as Response;
    };

    const t = new GatewayDocsTransport("http://hermes:8642", "secret", fetchImpl as never);
    const listing = await t.listDirectory("~/.hermes/projects");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://hermes:8642/api/v1/host/directory?path=~%2F.hermes%2Fprojects");
    expect(calls[0].method).toBe("GET");
    expect(calls[0].headers.Authorization).toBe("Bearer secret");
    expect(listing).toEqual({
      path: "~/.hermes/projects",
      entries: [
        { name: "repo-a", isDir: true, isGitRepo: true },
        { name: "plain", isDir: true, isGitRepo: false },
        { name: "file.txt", isDir: false },
      ],
    });
  });

  it("falls back to an empty entry set on a malformed response", async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({}) } as Response);
    const t = new GatewayDocsTransport("http://hermes:8642", null, fetchImpl as never);
    const listing = await t.listDirectory("/srv");
    expect(listing.path).toBe("/srv");
    expect(listing.entries).toEqual([]);
  });

  it("throws on a non-OK response so the picker surfaces the error", async () => {
    const fetchImpl = async () => ({ ok: false, status: 404 } as Response);
    const t = new GatewayDocsTransport("http://hermes:8642", null, fetchImpl as never);
    await expect(t.listDirectory("~/.hermes/projects")).rejects.toThrow("Docs gateway HTTP 404");
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
