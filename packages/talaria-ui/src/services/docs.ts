// Project docs client — M1 item 3 / projects.md "Project documentation".
//
// Each project has a Docs section: markdown files written and edited inside
// Talaria with a built-in markdown editor. These are PROJECT docs, distinct
// from the product's own `apps/docs` (P10).
//
// Storage (P10 / projects.md):
//   Project docs live on the Hermes server at
//       ~/.hermes/projects/<project>/docs/*.md
//   OUTSIDE the repo — so agents can read them as context when working inside
//   that project, and so they can hold things that shouldn't be committed to a
//   code repo (internal design, ADRs, meeting notes, roadmap rationale).
//
// Transport abstraction (P6 — one shared brain, both shells equal):
//   filesystem — desktop (Tauri): reads/writes the docs directory directly via
//                the host filesystem. The desktop shell injects a native
//                adapter (see `configureDocsTransport`); the shared package
//                stays Tauri-free so the web build never pulls it in.
//   gateway    — web (PWA) and fallback: REST calls routed through the user's
//                OWN Hermes gateway, which reads/writes the same
//                ~/.hermes/projects/<slug>/docs/ directory on the server.
//                Local-first (P5): the gateway is the user's machine, not a
//                Talaria-hosted cloud.
//
// The resulting files land on the Hermes server either way — the transport
// only changes HOW the app reaches them. Both shells mount the same Docs
// editor from the shared App (P6).
import { hermesClient } from "./hermes";

// The server-side root holding every project's workspace (aligned with how
// Hermes lays out projects + worktrees). Docs live at <root>/<slug>/docs/.
export const PROJECTS_ROOT = "~/.hermes/projects";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProjectDocMeta = {
  name: string; // filename, including ".md"
  path: string; // relative path within the project's docs dir (e.g. "plan.md")
  updatedAt?: number;
};

export type ProjectDoc = {
  name: string;
  path: string;
  content: string;
  updatedAt?: number;
};

export type DocsTransportKind = "filesystem" | "gateway";

// A transport knows HOW to reach a project's docs (native filesystem vs. the
// user's gateway). Both read/write the SAME server directory.
export interface DocsTransport {
  readonly kind: DocsTransportKind;
  // List the markdown files in a project's docs dir. Returns [] when the dir
  // doesn't exist yet (a project with no docs is valid — P8: no ceremony).
  list(projectSlug: string): Promise<Array<ProjectDocMeta>>;
  read(projectSlug: string, path: string): Promise<ProjectDoc>;
  write(projectSlug: string, path: string, content: string): Promise<void>;
  remove(projectSlug: string, path: string): Promise<void>;
  // Browse the host filesystem to pick a project's folder (project↔folder tie).
  // Lists one directory; each subdir reports whether it is a git repo root.
  listDirectory(path: string): Promise<HostDirListing>;
}

// ---------------------------------------------------------------------------
// Pure path helpers
// ---------------------------------------------------------------------------

// A project's docs directory on the server, as a slash-joined relative path
// under PROJECTS_ROOT. `slug` is the project's stable slug (projects store).
export function docsDir(projectSlug: string): string {
  return `${PROJECTS_ROOT}/${projectSlug}/docs`;
}

export function docsFilePath(projectSlug: string, path: string): string {
  return `${docsDir(projectSlug)}/${path}`;
}

// ---------------------------------------------------------------------------
// Host directory listing + git detection (project ↔ folder/repo tie, P9)
// ---------------------------------------------------------------------------
// Lets the UI browse the host filesystem to pick a project's folder, and tells
// whether that folder is a git repository. Desktop uses the native fs adapter;
// web routes through the user's gateway (same host). Both share the contract
// below so the picker and the git/non-git UX work identically in either shell.

export type HostDirEntry = {
  name: string;
  isDir: boolean;
  // Present only when isDir and the entry is a git repo root (has a .git).
  isGitRepo?: boolean;
};

export type HostDirListing = {
  path: string;
  entries: Array<HostDirEntry>;
};

// Detect a git repo root in a folder listing: a ".git" directory entry (or a
// ".git" file for worktrees/submodules) means the folder is a git checkout.
export function isGitRoot(entries: Array<HostDirEntry>): boolean {
  return entries.some((e) => e.name === ".git");
}

// Normalize a host path for display/safety: collapse //, strip a trailing
// slash (except root), and reject path traversal beyond the base. Returns the
// normalized path or null when unsafe.
export function normalizeHostDir(path: string): string | null {
  const cleaned = (path || "").replace(/\/+/g, "/").replace(/\/$/, "");
  if (!cleaned || cleaned.includes("..")) return null;
  return cleaned;
}

// The base the picker starts at. Desktop resolves relative to HOME (matches
// the docs filesystem adapter); web sends the literal path to the gateway.
export const HOST_DIR_BASE = "~/.hermes/projects";


// Normalize a user-entered doc name into a safe, deterministic filename.
// Lowercases, slugs the base, forces the .md extension, never allows a bare
// "." / empty result or path traversal (no "/").
export function normalizeDocName(input: string): string {
  const base = (input || "")
    .trim()
    .toLowerCase()
    .replace(/\.md$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/\//g, "");
  const safe = base || "doc";
  return `${safe}.md`;
}

// ---------------------------------------------------------------------------
// Filesystem transport (desktop / Tauri) — native host access.
// ---------------------------------------------------------------------------

// The minimal host-filesystem surface the desktop shell injects. Kept as an
// interface so the shared package never imports a Tauri module; the desktop
// app supplies a Tauri-fs-backed implementation via configureDocsTransport.
export interface DocsFileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  removeFile(path: string): Promise<void>;
  listDir(path: string): Promise<Array<{ name: string; isDir: boolean }>>;
}

export class FilesystemDocsTransport implements DocsTransport {
  readonly kind: "filesystem" = "filesystem";

  constructor(private fs: DocsFileSystem) {}

  async list(projectSlug: string): Promise<Array<ProjectDocMeta>> {
    try {
      const entries = await this.fs.listDir(docsDir(projectSlug));
      return entries
        .filter((e) => !e.isDir && e.name.endsWith(".md"))
        .map((e) => ({ name: e.name, path: e.name }));
    } catch {
      // No docs dir yet — treat as an empty (valid) doc set.
      return [];
    }
  }

  async read(projectSlug: string, path: string): Promise<ProjectDoc> {
    const content = await this.fs.readFile(docsFilePath(projectSlug, path));
    return { name: path, path, content };
  }

  async write(projectSlug: string, path: string, content: string): Promise<void> {
    await this.fs.writeFile(docsFilePath(projectSlug, path), content);
  }

  async remove(projectSlug: string, path: string): Promise<void> {
    await this.fs.removeFile(docsFilePath(projectSlug, path));
  }

  async listDirectory(path: string): Promise<HostDirListing> {
    const entries = await this.fs.listDir(path);
    // For each subdirectory, peek for a .git entry to flag git repo roots.
    const withGit: Array<HostDirEntry> = await Promise.all(
      entries.map(async (e) => {
        if (!e.isDir) return { name: e.name, isDir: false };
        let isGitRepo = false;
        try {
          const children = await this.fs.listDir(`${path}/${e.name}`);
          isGitRepo = isGitRoot(children);
        } catch {
          isGitRepo = false;
        }
        return { name: e.name, isDir: true, isGitRepo };
      })
    );
    return { path, entries: withGit };
  }
}

// ---------------------------------------------------------------------------
// Gateway transport (web / PWA + fallback) — routed through the user's gateway.
// ---------------------------------------------------------------------------

// Contract the Hermes gateway exposes for project docs (mirrors how the github
// sibling defined /api/v1/github/* as the gateway's docs-proxy surface).
export class GatewayDocsTransport implements DocsTransport {
  readonly kind: "gateway" = "gateway";

  constructor(
    public origin: string,
    public apiKey: string | null,
    private fetchImpl: typeof fetch = fetch
  ) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const res = await this.fetchImpl(`${this.origin}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`Docs gateway HTTP ${res.status}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json().catch(() => ({}))) as T;
  }

  private encodePath(p: string): string {
    return p.split("/").map(encodeURIComponent).join("/");
  }

  async list(projectSlug: string): Promise<Array<ProjectDocMeta>> {
    const data = await this.req<Array<ProjectDocMeta>>(
      "GET",
      `/api/v1/projects/${encodeURIComponent(projectSlug)}/docs`
    );
    return Array.isArray(data) ? data : [];
  }

  async read(projectSlug: string, path: string): Promise<ProjectDoc> {
    return this.req<ProjectDoc>(
      "GET",
      `/api/v1/projects/${encodeURIComponent(projectSlug)}/docs/${this.encodePath(path)}`
    );
  }

  async write(projectSlug: string, path: string, content: string): Promise<void> {
    await this.req<void>(
      "PUT",
      `/api/v1/projects/${encodeURIComponent(projectSlug)}/docs/${this.encodePath(path)}`,
      { content }
    );
  }

  async remove(projectSlug: string, path: string): Promise<void> {
    await this.req<void>(
      "DELETE",
      `/api/v1/projects/${encodeURIComponent(projectSlug)}/docs/${this.encodePath(path)}`
    );
  }

  async listDirectory(path: string): Promise<HostDirListing> {
    const data = await this.req<HostDirListing>(
      "GET",
      `/api/v1/host/directory?path=${encodeURIComponent(path)}`
    );
    return {
      path: data?.path ?? path,
      entries: Array.isArray(data?.entries) ? data.entries : [],
    };
  }
}

// ---------------------------------------------------------------------------
// DocsClient — the shared service both shells use.
// ---------------------------------------------------------------------------

export class DocsClient {
  transport: DocsTransport;

  constructor(transport?: DocsTransport) {
    // Default to the gateway transport (web + fallback) wired to the existing
    // Hermes client's origin/key. Desktop swaps in the filesystem transport.
    this.transport = transport ?? new GatewayDocsTransport(hermesClient.gatewayRoot(), hermesClient.apiKey);
  }

  setTransport(transport: DocsTransport) {
    this.transport = transport;
  }

  async list(projectSlug: string): Promise<Array<ProjectDocMeta>> {
    return this.transport.list(projectSlug);
  }
  async read(projectSlug: string, path: string): Promise<ProjectDoc> {
    return this.transport.read(projectSlug, path);
  }
  async write(projectSlug: string, path: string, content: string): Promise<void> {
    return this.transport.write(projectSlug, path, content);
  }
  async remove(projectSlug: string, path: string): Promise<void> {
    return this.transport.remove(projectSlug, path);
  }
  async listDirectory(path: string): Promise<HostDirListing> {
    return this.transport.listDirectory(path);
  }
}

// ── Desktop filesystem adapter injection ─────────────────────────────────
// The desktop (Tauri) shell supplies a native host-filesystem adapter before
// the store initializes, so desktop reads/writes project docs via the real
// filesystem (P6). Web never calls this. Until an adapter is registered,
// desktop falls back to the gateway transport (same server directory).
let registeredFileSystem: DocsFileSystem | null = null;

export function configureDocsFileSystem(fs: DocsFileSystem) {
  registeredFileSystem = fs;
}

export function hasFileSystemAdapter(): boolean {
  return registeredFileSystem !== null;
}

export function createDesktopTransport(): DocsTransport {
  if (registeredFileSystem) {
    return new FilesystemDocsTransport(registeredFileSystem);
  }
  // No native adapter yet — fall back to the gateway transport.
  return new GatewayDocsTransport(hermesClient.gatewayRoot(), hermesClient.apiKey);
}

export const docsClient = new DocsClient();
