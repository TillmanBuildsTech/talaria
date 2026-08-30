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

type HermesChatDB = Dexie & {
  agents: EntityTable<Agent, "name">;
  messages: EntityTable<ChatMessage, "id">;
  conversations: EntityTable<Conversation, "id">;
  settings: EntityTable<Setting, "key">;
  projects: EntityTable<Project, "id">;
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
// v3: add the projects (workspaces) table and a nullable projectId scope on
// conversations (P9). Conversations is re-declared to add the projectId index;
// unchanged rows are migrated as-is.
db.version(3).stores({
  conversations: "++id, title, lastMessage, updatedAt, projectId",
  projects: "id, slug, name, createdAt",
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
