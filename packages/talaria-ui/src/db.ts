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

type HermesChatDB = Dexie & {
  agents: EntityTable<Agent, "name">;
  messages: EntityTable<ChatMessage, "id">;
  conversations: EntityTable<Conversation, "id">;
  settings: EntityTable<Setting, "key">;
  connections: EntityTable<GitHubConnection, "id">;
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
// v3: add the GitHub connections table (M2 auth, spec §3.4).
db.version(3).stores({
  connections: "id, owner, type, status",
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
