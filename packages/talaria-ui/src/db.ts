// IndexedDB via Dexie — persists messages across reloads and offline.
//
// Tables:
//   agents        — the Hermes profiles you talk to (contacts). `name` is the
//                   profile id and maps directly to the gateway's /p/<name>/
//                   multiplex route.
//   messages      — chat rows; `agentName` tags which agent a message belongs
//                   to (profile id) for DM/group rendering and routing.
//   conversations — DM / group / default chats. A DM holds one agentIds entry,
//                   a group holds two+, a default holds none (routes to the
//                   gateway's default profile).
//   settings      — key/value (baseUrl, apiKey).
import Dexie, { type EntityTable } from "dexie";

export type Agent = {
  name: string;
  displayName: string;
  color: string;
  description?: string;
  apiKey?: string;
  sort: number;
};

export type MessageStatus = "sent" | "streaming" | "done" | "failed";

export type ChatMessage = {
  id?: number;
  conversationId: number;
  role: "user" | "assistant";
  content: string;
  status: MessageStatus;
  createdAt: number;
  system?: boolean;
  targetAgents?: Array<string>;
  agentName?: string | null;
  serverId?: string;
  startedAt?: number;
  elapsedMs?: number | null;
  tokens?: number | null;
  contextTokens?: number | null;
  modelName?: string | null;
};

export type ConversationKind = "default" | "dm" | "group";

export type Conversation = {
  id?: number;
  title: string;
  lastMessage: string;
  updatedAt: number;
  kind: ConversationKind;
  agentIds: Array<string>;
  messageCount?: number;
  model?: string | null;
  sessions?: Record<string, string>;
  // Project scope (P9): the workspace this conversation belongs to. null (or
  // absent) means the global/unassigned scope. Scoped conversations are
  // filtered out when a specific project is active.
  projectId?: string | null;
};

export type Setting = {
  key: string;
  value: string;
};

// GitHub connection (auth) — one row per connected GitHub account, keyed by
// the GitHub login. Mirrors the M2 spec §3.4. `tokenRef` is an opaque key that
// locates the stored token — a Dexie settings key on desktop (local), or a
// gateway-store key on web — never the raw token itself (P5: local-first).
export type GitHubConnectionType = "device" | "pat";
export type GitHubConnectionStatus = "connected" | "reconnecting" | "revoked";

export type GitHubConnection = {
  id: string; // GitHub owner login
  owner: string;
  type: GitHubConnectionType;
  status: GitHubConnectionStatus;
  scopes: Array<string>;
  tokenRef: string;
  gatewayOrigin: string;
  lastVerifiedAt: number;
  connectedAt: number;
};

// A Project is a self-contained workspace (P9): its own board, PO agent,
// tasks, chats, and docs. id is an opaque UUID; the global/unassigned scope
// is represented by `projectId: null` on scoped rows (no table row exists for
// it — it is a reserved, non-deletable default).
export type Project = {
  id: string;
  slug: string;
  name: string;
  description?: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
};

// A cached GitHub repo, scoped to a project (P9). Local-first cache for the
// repo browser; actions always hit the live API. `id` is `${owner}/${name}`.
export type Repo = {
  id: string; // `${owner}/${name}`
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  description?: string;
  htmlUrl: string; // linkable artifact (P3)
  project: string; // P9 scope — the project (id or slug) this repo is attached to; "" = global
  lastFetchedAt: number;
};

// Offline-read cache for the PR feature (M2 §5 caching rule): PRs and repo
// gates are cached for offline read; EVERY action (review, merge) always hits
// the live API and refreshes the cache — the cache is never a source of truth
// for gates (P1). (Distinct from the repo-browser `repos` table.)
export type CachedRepo = {
  fullName: string; // "owner/repo"
  name: string;
  owner: string;
  defaultBranch: string;
  htmlUrl: string;
  allowSquashMerge: boolean;
  allowMergeCommit: boolean;
  allowRebaseMerge: boolean;
  updatedAt: number;
};

export type CachedPullRequest = {
  id: string; // "owner/repo#number"
  fullName: string;
  number: number;
  title: string;
  author: string;
  state: string;
  merged: boolean;
  htmlUrl: string;
  headRef: string;
  headSha: string;
  baseRef: string;
  updatedAt: number;
  mergeableState?: string | null;
  draft?: boolean;
};

export type CachedRepoGates = {
  fullName: string;
  defaultBranch: string;
  branchProtected: boolean;
  requiredChecks: Array<string>;
  requiredReviewers: number;
  enforceAdmins: boolean;
  squashOnly: boolean;
  allowMergeCommit: boolean;
  allowRebaseMerge: boolean;
  fetchedAt: number;
};

type HermesChatDB = Dexie & {
  agents: EntityTable<Agent, "name">;
  messages: EntityTable<ChatMessage, "id">;
  conversations: EntityTable<Conversation, "id">;
  settings: EntityTable<Setting, "key">;
  connections: EntityTable<GitHubConnection, "id">;
  projects: EntityTable<Project, "id">;
  repos: EntityTable<Repo, "id">;
  prCachedRepos: EntityTable<CachedRepo, "fullName">;
  pullRequests: EntityTable<CachedPullRequest, "id">;
  repoGates: EntityTable<CachedRepoGates, "fullName">;
};

const db = new Dexie("HermesChatDB") as HermesChatDB;
db.version(1).stores({
  messages: "++id, conversationId, role, status, createdAt",
  conversations: "++id, title, lastMessage, updatedAt",
  settings: "key",
});
// v2: add the agents (contacts) table. Dexie keeps unchanged stores as-is.
db.version(2).stores({
  agents: "name, displayName, color, sort",
});
// v3: add the GitHub connections table (M2 auth) and the projects (workspaces)
// table plus a nullable projectId scope on conversations (P9). Both land in a
// single v3 migration; unchanged rows migrate as-is.
db.version(3).stores({
  connections: "id, owner, type, status",
  conversations: "++id, title, lastMessage, updatedAt, projectId",
  projects: "id, slug, name, createdAt",
});
// v4: add the repos cache (M2 repo browser, spec §4.1), scoped per project.
db.version(4).stores({
  repos: "id, owner, name, project, lastFetchedAt",
});
// v5: add the M2 PR offline-read caches — PR repos, pull requests, repo gates.
// The cache is for offline READ only; merge/review actions always hit the live
// API. (Distinct table names so they don't collide with the repo-browser repos.)
db.version(5).stores({
  prCachedRepos: "fullName, owner, updatedAt",
  pullRequests: "id, fullName, updatedAt",
  repoGates: "fullName, fetchedAt",
});

// Default agents seeded from the Hermes profiles on this host. Users can add /
// edit / remove contacts in Settings; the list is also editable for remote hosts.
const DEFAULT_AGENTS: Array<Agent> = [
  { name: "developer", displayName: "Developer", description: "Coding & infrastructure agent", color: "#38bdf8", sort: 0 },
  { name: "researcher", displayName: "Researcher", description: "Research & lead-gen agent", color: "#a78bfa", sort: 1 },
  { name: "operations", displayName: "Operations", description: "Ops & pipeline agent", color: "#34d399", sort: 2 },
  { name: "product-owner", displayName: "Product Owner", description: "Product & roadmap agent", color: "#fbbf24", sort: 3 },
  { name: "quality-assurance", displayName: "QA", description: "Testing & review agent", color: "#fb7185", sort: 4 },
  { name: "comedian", displayName: "Comedian", description: "Jokes & banter agent", color: "#f472b6", sort: 5 },
];

// Seed default agents on first run (idempotent). No default conversation is
// created — a new chat only appears in the list once its first message is sent.
db.on("ready", async () => {
  const agentCount = await db.agents.count();
  if (agentCount === 0) {
    await db.agents.bulkAdd(DEFAULT_AGENTS);
  }
});

export default db;
