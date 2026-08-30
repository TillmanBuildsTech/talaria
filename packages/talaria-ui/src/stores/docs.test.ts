import { beforeEach, describe, expect, it } from "vitest";
import {
  FilesystemDocsTransport,
  docsClient,
  type DocsFileSystem,
} from "../services/docs";
import { useDocsStore } from "./docs";

// In-memory filesystem so store tests exercise the real transport round-trip.
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
        if (key.startsWith(`${path}/`)) entries.push({ name: key.slice(path.length + 1), isDir: false });
      }
      return entries;
    },
  };
  return { ...fs, store };
}

const MEM = memoryFs();

beforeEach(() => {
  MEM.store.clear();
  // Point the shared client at the in-memory filesystem (desktop transport).
  docsClient.setTransport(new FilesystemDocsTransport(MEM));
  useDocsStore.setState({ docs: [], activeDoc: null, draft: "", loading: false, saving: false, error: null });
});

describe("docs store", () => {
  it("loads a project's docs on scope switch", async () => {
    MEM.store.set("~/.hermes/projects/abc/docs/plan.md", "# Plan");
    await useDocsStore.getState().loadForProject("abc");
    expect(useDocsStore.getState().docs.map((d) => d.name)).toEqual(["plan.md"]);
  });

  it("resets to empty for the global/unassigned scope (no docs dir)", async () => {
    await useDocsStore.getState().loadForProject("abc");
    await useDocsStore.getState().loadForProject(null);
    expect(useDocsStore.getState().docs).toEqual([]);
    expect(useDocsStore.getState().activeDoc).toBeNull();
  });

  it("opens a doc and loads its content into the draft", async () => {
    MEM.store.set("~/.hermes/projects/serv/docs/roadmap.md", "# Roadmap");
    await useDocsStore.getState().loadForProject("serv");
    await useDocsStore.getState().openDoc("serv", "roadmap.md");
    expect(useDocsStore.getState().activeDoc?.name).toBe("roadmap.md");
    expect(useDocsStore.getState().draft).toBe("# Roadmap");
  });

  it("saves the draft back to the server file", async () => {
    MEM.store.set("~/.hermes/projects/serv/docs/roadmap.md", "# Roadmap");
    await useDocsStore.getState().loadForProject("serv");
    await useDocsStore.getState().openDoc("serv", "roadmap.md");
    useDocsStore.getState().setDraft("# Roadmap v2\n\n- scoped");
    await useDocsStore.getState().save("serv");
    expect(MEM.store.get("~/.hermes/projects/serv/docs/roadmap.md")).toBe("# Roadmap v2\n\n- scoped");
    expect(useDocsStore.getState().activeDoc?.content).toBe("# Roadmap v2\n\n- scoped");
  });

  it("creates a doc and persists it to the server dir", async () => {
    await useDocsStore.getState().createDoc("abc", "adr-1.md");
    expect(MEM.store.has("~/.hermes/projects/abc/docs/adr-1.md")).toBe(true);
    expect(useDocsStore.getState().docs.map((d) => d.name)).toContain("adr-1.md");
  });

  it("deletes a doc and clears the open doc if it was active", async () => {
    MEM.store.set("~/.hermes/projects/abc/docs/plan.md", "# Plan");
    await useDocsStore.getState().loadForProject("abc");
    await useDocsStore.getState().openDoc("abc", "plan.md");
    await useDocsStore.getState().deleteDoc("abc", "plan.md");
    expect(MEM.store.has("~/.hermes/projects/abc/docs/plan.md")).toBe(false);
    expect(useDocsStore.getState().activeDoc).toBeNull();
    expect(useDocsStore.getState().docs).toEqual([]);
  });
});
