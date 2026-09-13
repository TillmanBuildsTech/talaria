import { create } from "zustand";
import db, { type Agent, type ChatMessage, type Conversation } from "../db";
import { KNOWN_MODELS, type ModelInfo, knownWindowFor } from "../models";
import { describeError, diagnostics } from "../services/diagnostics";
import { StreamError, type StreamFailureKind, createConnectionMonitor, hermesClient } from "../services/hermes";
import { useProjectsStore } from "./projects";
import { useObservabilityStore } from "./observability";

const DEFAULT_CONTEXT_WINDOW = 128_000;

// ── project scoping (P9) ─────────────────────────────────────────────────
// Scoped stores read the active project at their boundary. This chat store
// filters conversations by the active scope and tags new ones with it, so
// switching projects swaps the whole chat namespace.
function activeScope(): string | null {
  return useProjectsStore.getState().scopeForCreate();
}

function inScope(conv: Conversation): boolean {
  return (conv.projectId ?? null) === activeScope();
}

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline";

/** Why a turn failed + whether retrying is worth the user's time. */
export type ChatFailure = {
  kind: StreamFailureKind;
  message: string;
  detail?: string;
  retriable: boolean;
  at: number;
};

export type SlashCommand = { cmd: string; desc: string };

const COMMANDS: Array<SlashCommand> = [
  { cmd: "/new", desc: "Start a new (blank) chat" },
  { cmd: "/clear", desc: "Clear this conversation’s messages" },
  { cmd: "/help", desc: "Show this command list" },
  { cmd: "/agents", desc: "List available agents" },
  { cmd: "/dm <name>", desc: "Open a DM with an agent" },
  { cmd: "/group <a>, <b>", desc: "Start a group chat" },
  { cmd: "/rename <title>", desc: "Rename this conversation" },
];

// Parse @mentions in a group message against the conversation's member agents.
// Returns the matched member profile names (lowercased lookup) plus 'all' if
// @all was used.
function parseMentions(content: string, members: Array<string>): Array<string> {
  const found: Array<string> = [];
  const re = /@([A-Za-z0-9][A-Za-z0-9_-]*)/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: matches the original regex-scan loop
  while ((m = re.exec(content))) {
    const token = m[1].toLowerCase();
    if (token === "all") {
      if (!found.includes("all")) found.push("all");
      continue;
    }
    const member = members.find((mem) => mem.toLowerCase() === token);
    if (member && !found.includes(member)) found.push(member);
  }
  return found;
}

// Decide which agent(s) an outgoing message is routed to.
//   default conv → [null]            (gateway default profile, /v1/chat/completions)
//   dm           → [that agent]
//   group        → every member who was @mentioned; @all → all members;
//                  unaddressed → the group's primary (first) member.
function resolveTargets(conv: Conversation | null | undefined, content: string): Array<string | null> {
  const members = (conv?.agentIds || []).filter(Boolean);
  if (!conv || conv.kind !== "group" || members.length === 0) {
    return [members[0] || null];
  }
  const mentions = parseMentions(content, members);
  if (mentions.includes("all")) {
    return members;
  }
  const named = mentions.filter((n) => n !== "all");
  return named.length > 0 ? named : [members[0]];
}

function titleCase(s: string): string {
  return s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function pickColor(i: number): string {
  const palette = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#f472b6", "#f87171", "#60a5fa"];
  return palette[i % palette.length];
}

// Map an agent name to a stable conversation key ("default" for no prefix).
function agentKeyName(agentName?: string | null): string {
  return agentName || "default";
}

export type ChatState = {
  // ── state ──────────────────────────────────────────────────────────────
  messages: Array<ChatMessage>;
  conversations: Array<Conversation>;
  agents: Array<Agent>;
  // agentName -> { model, provider, contextLength } (from /talaria-config;
  // the models Hermes is actually configured to run per profile).
  modelsMap: Record<string, ModelInfo>;
  // User-added models (via the dropdown's custom-model entry). Merged into
  // the dropdown ungated and persisted to settings — the escape hatch for
  // any model the curated catalog doesn't list yet.
  customModels: Record<string, ModelInfo>;
  // Model providers the host has credentials for (from /talaria-config, read
  // from the host's .env files). Only their models are shown in the dropdown.
  availableModelProviders: Array<string>;
  activeConversationId: number | null;
  connectionStatus: ConnectionStatus;
  baseUrl: string;
  apiKey: string;
  error: string | null;
  /** Why the last turn failed (cleared on the next successful send). */
  lastError: ChatFailure | null;
  /** Live gateway-health text ("gateway reachable", "API key rejected", …). */
  connectionDetail: string | null;
  // Count of in-flight streams (group fan-out can have several at once).
  activeStreams: number;
  COMMANDS: Array<SlashCommand>;

  // ── computed (call as functions — Zustand has no reactive getters) ──────
  isOnline: () => boolean;
  isStreaming: () => boolean;
  canSend: () => boolean;
  sidebarConversations: () => Array<Conversation>;
  activeConvTitle: () => string;
  activeGroupMembers: () => Array<string>;
  configuredModels: () => Array<ModelInfo>;
  contextWindowFor: (model: string | null | undefined) => number;
  providerFor: (model: string | null | undefined) => string;
  agentModel: (name: string | null | undefined) => string | null;
  activeContextTokens: () => number;
  activeModelName: () => string | null;
  activeContextWindow: () => number;
  setConversationModel: (modelName: string | null) => void;
  /** Add a user-specified model to the dropdown (persisted to settings). */
  addCustomModel: (model: string, provider?: string) => Promise<void>;

  // ── helpers ───────────────────────────────────────────────────────────
  agentDisplay: (name: string | null | undefined) => string | null;
  agentColor: (name: string | null | undefined) => string;
  agentKey: (name: string | null | undefined) => string | null;
  convTitle: (conv: Conversation | null | undefined) => string;

  // ── actions ───────────────────────────────────────────────────────────
  init: () => Promise<void>;
  destroy: () => void;
  loadAgents: () => Promise<void>;
  addAgent: (agent: { name: string; displayName?: string; color?: string; description?: string; apiKey?: string }) => Promise<void>;
  removeAgent: (name: string) => Promise<void>;
  loadConversations: () => Promise<void>;
  reloadForScope: () => Promise<void>;
  recountMessageCount: (id: number) => Promise<void>;
  renameConversation: (id: number, title: string) => Promise<void>;
  loadMessages: () => Promise<void>;
  syncConversationFromServer: (conv: Conversation | null | undefined) => Promise<void>;
  switchConversation: (id: number) => Promise<void>;
  newConversation: () => Promise<void>;
  newDirectMessage: (agentName: string) => Promise<number | null>;
  newGroupConversation: (agentNames: Array<string>) => Promise<number | null>;
  deleteConversation: (id: number) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  retryMessage: (messageId: number) => Promise<void>;
  stopStreaming: () => Promise<void>;
  setBaseUrl: (url: string) => Promise<void>;
  setApiKey: (key: string) => Promise<void>;
  /** Probe gateway health now (the connection pill's tap handler). */
  checkConnection: () => Promise<void>;

  // slash commands
  runCommand: (raw: string) => Promise<boolean>;
  clearConversation: () => Promise<void>;
  pushSystem: (text: string) => Promise<void>;
  commandHelp: () => string;
  agentList: () => string;

  // explicit reset action — replaces the Vue app's direct store-field mutation
  // (`store.messages = []`) with a proper action for the "Clear All Data" flow.
  resetAll: () => void;
};

let connectionMonitor: ReturnType<typeof createConnectionMonitor> | null = null;

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  conversations: [],
  agents: [],
  modelsMap: {},
  customModels: {},
  availableModelProviders: [],
  activeConversationId: null,
  connectionStatus: "connecting",
  baseUrl: "/api/v1",
  apiKey: typeof __HERMES_API_KEY__ !== "undefined" ? (__HERMES_API_KEY__ ?? "") : "",
  error: null,
  lastError: null,
  connectionDetail: null,
  activeStreams: 0,
  COMMANDS,

  isOnline: () => get().connectionStatus !== "offline",
  isStreaming: () => get().activeStreams > 0,
  canSend: () => !get().isStreaming(),

  // Only conversations that actually have messages appear in the sidebar —
  // a brand-new (untitled, unsent) chat is hidden until something is said.
  // Scoped to the active project (P9): a specific project shows only its own
  // chats; the global scope shows the unassigned ones.
  sidebarConversations: () => get().conversations.filter((c) => (c.messageCount || 0) > 0 && inScope(c)),

  agentDisplay: (name) => {
    if (!name) return null;
    const a = get().agents.find((x) => x.name === name);
    return a?.displayName || titleCase(name);
  },
  agentColor: (name) => {
    const a = get().agents.find((x) => x.name === name);
    return a?.color || "#64748b";
  },
  // Per-agent API key (multiplex scopes API_SERVER_KEY per profile). Falls back
  // to the global key (the default profile's) when an agent has none stored.
  agentKey: (name) => {
    if (!name) return get().apiKey;
    const a = get().agents.find((x) => x.name === name);
    return a?.apiKey || get().apiKey;
  },
  // Title for a conversation: DM → agent display name, group → joined names.
  convTitle: (conv) => {
    if (!conv) return "Talaria";
    const { agentDisplay } = get();
    if (conv.kind === "group") {
      const names = (conv.agentIds || []).map(agentDisplay).filter(Boolean) as Array<string>;
      return names.length ? names.join(", ") : conv.title;
    }
    if (conv.kind === "dm" && conv.agentIds?.length) {
      return agentDisplay(conv.agentIds[0]) || conv.title;
    }
    return conv.title;
  },

  activeConvTitle: () => {
    const { conversations, activeConversationId, convTitle } = get();
    const conv = conversations.find((c) => c.id === activeConversationId);
    return convTitle(conv);
  },

  // Model dropdown list: the curated realistic catalog (models Hermes supports
  // on the in-use providers) PLUS each profile's configured default. Deduped by
  // model id so per-profile entries that match the catalog collapse into one.
  configuredModels: () => {
    const { availableModelProviders, modelsMap, customModels } = get();
    const out: Record<string, ModelInfo> = {};
    const add = (model: string | undefined, provider: string | undefined, ctx: number | null | undefined) => {
      if (!model) return;
      const cur = out[model];
      out[model] = {
        model,
        provider: cur?.provider || provider || "",
        contextLength: cur?.contextLength || ctx || null,
      };
    };
    // Only offer catalog models whose provider actually has a credential on
    // the host (those are the ones that will run). Unknown host → show all.
    const gated = availableModelProviders.length > 0;
    for (const km of KNOWN_MODELS) {
      if (gated && !availableModelProviders.includes(km.provider)) continue;
      add(km.model, km.provider, km.contextLength);
    }
    for (const info of Object.values(modelsMap)) {
      if (info?.model) add(info.model, info.provider, info.contextLength);
    }
    // User-added models are always shown (explicit choice beats the gate).
    for (const info of Object.values(customModels)) {
      if (info?.model) add(info.model, info.provider, info.contextLength);
    }
    return Object.values(out).sort((a, b) => a.model.localeCompare(b.model));
  },
  contextWindowFor: (model) => {
    if (!model) return DEFAULT_CONTEXT_WINDOW;
    const c = get()
      .configuredModels()
      .find((m) => m.model === model);
    return c?.contextLength || knownWindowFor(model) || DEFAULT_CONTEXT_WINDOW;
  },
  providerFor: (model) => {
    if (!model) return "";
    const c = get()
      .configuredModels()
      .find((m) => m.model === model);
    return c?.provider || "";
  },
  // Configured model for an agent (profile) — no override involved.
  agentModel: (name) => {
    if (!name) return null;
    const i = get().modelsMap[name];
    return i?.model || null;
  },

  // Real input context size of the last assistant reply in the active
  // conversation — i.e. how many prompt tokens the next request will cost.
  activeContextTokens: () => {
    const { messages } = get();
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.contextTokens != null && !m.system) return m.contextTokens;
    }
    return 0;
  },
  // Effective model for the active conversation: a user-set override, else the
  // active agent's configured model.
  activeModelName: () => {
    const { conversations, activeConversationId, agentModel } = get();
    if (!activeConversationId) return null;
    const conv = conversations.find((c) => c.id === activeConversationId);
    if (!conv) return null;
    if (conv.model) return conv.model;
    const agent = conv.agentIds?.[0] || null;
    return agentModel(agent);
  },
  activeContextWindow: () => get().contextWindowFor(get().activeModelName() || ""),

  // Set (or clear, null) a per-conversation model override.
  setConversationModel: (modelName) => {
    const { activeConversationId, conversations } = get();
    if (!activeConversationId) return;
    const m = (modelName || "").trim() || null;
    const conv = conversations.find((c) => c.id === activeConversationId);
    if (conv) {
      set({ conversations: conversations.map((c) => (c.id === conv.id ? { ...c, model: m } : c)) });
    }
    db.conversations.update(activeConversationId, { model: m });
  },

  // Add a user-specified model to the dropdown and select it for the active
  // conversation. Provider defaults to openrouter (the host-wide credential);
  // pass an explicit provider for native (non-OpenRouter) models.
  addCustomModel: async (model, provider) => {
    const m = (model || "").trim();
    if (!m) return;
    const p = (provider || "").trim() || "openrouter";
    const entry: ModelInfo = { model: m, provider: p, contextLength: knownWindowFor(m) };
    const next = { ...get().customModels, [m]: entry };
    set({ customModels: next });
    await db.settings.put({ key: "customModels", value: JSON.stringify(next) });
    get().setConversationModel(m);
  },

  // Members of the active group conversation (for mention chips/hints).
  activeGroupMembers: () => {
    const { conversations, activeConversationId } = get();
    const conv = conversations.find((c) => c.id === activeConversationId);
    if (!conv || conv.kind !== "group" || !conv.agentIds?.length) return [];
    return conv.agentIds;
  },

  // ── actions ────────────────────────────────────────────────────────────

  async loadAgents() {
    const agents = await db.agents.orderBy("sort").toArray();
    set({ agents });
  },

  async addAgent({ name, displayName, color, description, apiKey }) {
    if (!name) return;
    // Upsert: preserve color/sort when editing an existing agent.
    const existing = await db.agents.get(name);
    const sort = existing ? existing.sort : (await db.agents.count()) + 1;
    await db.agents.put({
      name,
      displayName: displayName || existing?.displayName || titleCase(name),
      color: color || existing?.color || pickColor(sort),
      description: description !== undefined ? description : existing?.description || "",
      apiKey: apiKey !== undefined ? apiKey : existing?.apiKey || "",
      sort,
    });
    await get().loadAgents();
  },

  async removeAgent(name) {
    await db.agents.delete(name);
    await get().loadAgents();
  },

  // Load conversations list from IndexedDB, filtered to the active project
  // scope (P9).
  async loadConversations() {
    const list = await db.conversations.orderBy("updatedAt").reverse().toArray();
    const scoped = list.filter(inScope);
    for (const c of scoped) {
      const n = await db.messages.where("conversationId").equals(c.id as number).count();
      // Server-discovered conversations carry a server message_count but no
      // local rows yet (messages load from the gateway when opened) — don't
      // clobber their known count down to 0, which would hide them from the
      // sidebar. Local rows win once they exist (e.g. after opening a chat).
      c.messageCount = n > 0 ? n : c.messageCount || 0;
    }
    set({ conversations: scoped });
    // A conversation from a now-inactive project scope must not stay selected
    // (P9 — no cross-project leakage in the active view).
    const { activeConversationId } = get();
    if (activeConversationId && !scoped.some((c) => c.id === activeConversationId)) {
      set({ activeConversationId: null, messages: [] });
    }
    if (!get().activeConversationId) {
      const firstReal = scoped.find((c) => (c.messageCount || 0) > 0);
      if (firstReal) set({ activeConversationId: firstReal.id ?? null });
    }
  },

  // Re-query the whole chat namespace for a newly-selected project scope and
  // drop any selection from the previous scope. Called by the app when the
  // user switches projects so the view/data namespace swaps wholesale.
  async reloadForScope() {
    set({ messages: [] });
    await get().loadConversations();
    if (get().activeConversationId) {
      await get().loadMessages();
      const conv = await db.conversations.get(get().activeConversationId as number);
      await get().syncConversationFromServer(conv ?? null);
    }
  },

  // Refresh a conversation's message count (drives sidebar visibility).
  async recountMessageCount(id) {
    const n = await db.messages.where("conversationId").equals(id).count();
    const { conversations } = get();
    const conv = conversations.find((c) => c.id === id);
    if (conv && conv.messageCount !== n) {
      set({ conversations: conversations.map((c) => (c.id === id ? { ...c, messageCount: n } : c)) });
      await db.conversations.update(id, { messageCount: n });
    }
  },

  // Rename a conversation (editable title).
  async renameConversation(id, title) {
    const t = (title || "").trim();
    if (!t) return;
    const { conversations } = get();
    set({ conversations: conversations.map((c) => (c.id === id ? { ...c, title: t } : c)) });
    await db.conversations.update(id, { title: t });
  },

  // Load messages for active conversation
  async loadMessages() {
    const { activeConversationId } = get();
    if (!activeConversationId) return;
    const messages = await db.messages.where("conversationId").equals(activeConversationId).sortBy("createdAt");
    set({ messages });
  },

  // Restore a conversation's history from the Hermes gateway (source of truth)
  // so the same chat shows up on every device. Replaces local rows with the
  // merged server timeline for the conversation's per-agent sessions.
  async syncConversationFromServer(conv) {
    if (!conv || get().isStreaming()) return;
    const entries = Object.entries(conv.sessions || {});
    if (entries.length === 0) return;

    const { agentKey } = get();
    const fetched = await Promise.all(
      entries.map(async ([key, sid]) => {
        const agentName = key === "default" ? null : key;
        try {
          const msgs = await hermesClient.fetchSessionMessages(agentName, sid, {
            apiKey: agentKey(agentName),
          });
          // Show only the user/assistant turns — filter internal tool/reasoning rows.
          return msgs
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({
              serverId: m.id,
              role: m.role as "user" | "assistant",
              content: m.content || "",
              createdAt: m.timestamp || Date.now(),
              agentName,
            }));
        } catch (err) {
          // A profile whose history can't be read (missing key, gateway 5xx,
          // old session) must not blank the chat — but it must not vanish
          // either: say which profile failed and why.
          diagnostics.warn("chat.sync", `Could not load server history for ${agentName ?? "default"}`, {
            sessionId: sid,
            ...describeError(err),
          });
          return [];
        }
      })
    );
    const flat = fetched.flat();
    if (flat.length === 0) return;

    const seen = new Set<string>();
    const merged: Array<(typeof flat)[number]> = [];
    for (const m of flat) {
      if (m.serverId && !seen.has(m.serverId)) {
        seen.add(m.serverId);
        merged.push(m);
      }
    }
    merged.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

    // The server is authoritative — replace local rows for this conversation.
    await db.messages.where("conversationId").equals(conv.id as number).delete();
    for (const m of merged) {
      await db.messages.add({
        conversationId: conv.id as number,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        agentName: m.agentName,
        serverId: m.serverId,
        status: "done",
        startedAt: m.createdAt,
        elapsedMs: null,
        tokens: null,
      });
    }
    await get().loadMessages();
    await get().recountMessageCount(conv.id as number);
  },

  // Parse our session-id convention "talaria-<agent>-<ts>-<rand>" to recover
  // which agent (profile) a server session belongs to.
  // (kept as a module-scoped helper below via closures — inlined here)

  // Auto-provision REAL per-profile API keys from the local host's config
  // endpoint so every agent works out of the box (no fabricated values).
  // Reads /talaria-config served by serve.mjs; harmless if absent (remote host).
  async init() {
    // Load saved base URL
    const savedUrl = await db.settings.get("baseUrl");
    if (savedUrl?.value) {
      set({ baseUrl: savedUrl.value });
      hermesClient.setBaseUrl(savedUrl.value);
    }

    // Load saved API key, fall back to build-injected default
    const savedKey = await db.settings.get("apiKey");
    if (savedKey?.value) {
      set({ apiKey: savedKey.value });
      hermesClient.setApiKey(savedKey.value);
    } else if (get().apiKey) {
      hermesClient.setApiKey(get().apiKey);
    }

    // Restore user-added custom models (persisted by addCustomModel).
    try {
      const savedModels = await db.settings.get("customModels");
      if (savedModels?.value) {
        const parsed = JSON.parse(savedModels.value) as Record<string, ModelInfo>;
        if (parsed && typeof parsed === "object") set({ customModels: parsed });
      }
    } catch {
      // Corrupt entry — start clean rather than break init.
    }

    await get().loadAgents();
    // Fill agents with their real per-profile API keys (serve.mjs config).
    await applyServerConfig(set, get);
    await get().loadConversations();
    // Rebuild conversations from server sessions (cross-device sidebar).
    await discoverServerConversations(get);
    await get().loadConversations();
    if (get().activeConversationId) {
      await get().loadMessages();
      const conv = await db.conversations.get(get().activeConversationId as number);
      await get().syncConversationFromServer(conv ?? null);
    }

    // Start connection monitoring. Presence is driven by a REAL gateway probe
    // (/v1/models through the app's own origin), never by navigator.onLine —
    // the browser reports the device network, not whether the gateway is up.
    // One failed probe is not enough to declare the gateway offline.
    connectionMonitor = createConnectionMonitor({
      onOnline: () => {
        set({ connectionStatus: "connected" });
        void flushPendingRetries(set, get);
      },
      onOffline: () => {
        diagnostics.warn("health", "Gateway unreachable — marking the connection offline");
        set({ connectionStatus: "offline" });
      },
      onProbe: (result) => {
        set({
          connectionDetail: `${result.reason} · ${result.tookMs}ms`,
          connectionStatus: result.reachable ? "connected" : get().connectionStatus === "connecting" ? "reconnecting" : get().connectionStatus,
        });
      },
    });
    connectionMonitor.startHealthChecks();
    const health = await connectionMonitor.checkNow();
    diagnostics.info("chat.init", "Chat store ready", {
      gateways: connectionMonitor ? "monitoring" : "off",
      baseUrl: get().baseUrl,
      agents: get().agents.length,
      conversations: get().conversations.length,
      health: `${health.reason} (${health.status ?? "no response"}, ${health.tookMs}ms)`,
      hasApiKey: Boolean(get().apiKey),
    });
  },

  // Teardown
  destroy() {
    connectionMonitor?.destroy();
    for (const t of retryTimers.values()) clearTimeout(t);
    retryTimers.clear();
    hermesClient.abort();
    diagnostics.info("chat", "Chat store torn down");
  },

  // Switch conversation
  async switchConversation(id) {
    set({ activeConversationId: id });
    await get().loadMessages();
    const conv = await db.conversations.get(id);
    await get().syncConversationFromServer(conv ?? null);
  },

  // New chat: an unsent draft — no DB row until the first message is sent, so
  // it stays out of the sidebar until then.
  async newConversation() {
    set({ activeConversationId: null, messages: [] });
    await get().loadConversations();
  },

  // 1:1 with a specific agent (profile).
  async newDirectMessage(agentName) {
    if (!agentName) return null;
    // Reuse an existing DM with this agent in THIS scope if there is one
    // (never reach into another project's namespace, P9).
    const existing = await db.conversations
      .filter((c) => c.kind === "dm" && c.agentIds?.[0] === agentName && (c.projectId ?? null) === activeScope())
      .first();
    const id = existing
      ? (existing.id as number)
      : ((await db.conversations.add({
          title: "New Chat",
          lastMessage: "",
          updatedAt: Date.now(),
          kind: "dm",
          agentIds: [agentName],
          projectId: activeScope(),
        })) as number);
    set({ activeConversationId: id });
    await get().loadMessages();
    await get().loadConversations();
    return id;
  },

  // Group chat with the named agent profiles.
  async newGroupConversation(agentNames) {
    const members = (agentNames || []).filter(Boolean);
    if (members.length < 1) return null;
    // A single-member "group" degrades to a DM.
    if (members.length === 1) return get().newDirectMessage(members[0]);
    const id = (await db.conversations.add({
      title: "New Chat",
      lastMessage: "",
      updatedAt: Date.now(),
      kind: "group",
      agentIds: members,
      projectId: activeScope(),
    })) as number;
    set({ activeConversationId: id, messages: [] });
    await get().loadConversations();
    return id;
  },

  // Delete conversation
  async deleteConversation(id) {
    await db.messages.where("conversationId").equals(id).delete();
    await db.conversations.delete(id);
    if (get().activeConversationId === id) {
      await get().loadConversations();
      const { conversations, sidebarConversations } = get();
      if (conversations.length > 0) {
        const target = sidebarConversations()[0] || conversations[0];
        await get().switchConversation(target.id as number);
      } else {
        set({ activeConversationId: null, messages: [] });
      }
    }
    await get().loadConversations();
  },

  // Send a message. Routes to one or more agents based on the conversation
  // kind and any @mentions; streams a reply from each target concurrently.
  async sendMessage(content) {
    if (!content.trim() || get().isStreaming()) return;

    // Slash commands run locally against the app (store/session), never sent
    // to an agent. Everything starting with "/" is consumed here.
    if (content.trim().startsWith("/")) {
      await get().runCommand(content.trim());
      return;
    }

    // Lazily create the conversation row on first send (absent for a draft).
    const { activeConversationId } = get();
    let conv = activeConversationId ? await db.conversations.get(activeConversationId) : null;
    if (!conv) {
      const id = await db.conversations.add({
        title: "New Chat",
        lastMessage: "",
        updatedAt: Date.now(),
        kind: "default",
        agentIds: [],
        messageCount: 0,
        sessions: {},
        projectId: activeScope(),
      });
      set({ activeConversationId: id });
      conv = await db.conversations.get(id);
    }
    if (!conv) return;

    const text = content.trim();
    set({ error: null });

    // 1. Optimistic user message
    const targets = resolveTargets(conv, text);
    const targetAgents = targets.filter(Boolean) as Array<string>;
    const userMsg: ChatMessage = {
      conversationId: conv.id as number,
      role: "user",
      content: text,
      status: "sent",
      createdAt: Date.now(),
      // Names of agents this message is addressed to (for mention badge).
      targetAgents,
    };
    const userId = await db.messages.add(userMsg);
    userMsg.id = userId;
    set({ messages: [...get().messages, userMsg] });
    await get().recountMessageCount(conv.id as number);

    // 2. Update conversation metadata
    await db.conversations.update(conv.id as number, {
      lastMessage: text,
      updatedAt: Date.now(),
    });

    diagnostics.info("chat.send", `Sending to ${targets.map((t) => agentKeyName(t)).join(", ")}`, {
      conversationId: conv.id,
      kind: conv.kind,
      chars: text.length,
      streaming: get().isStreaming(),
    });

    // 3. Stream a reply from each target.
    hermesClient.abort(); // cancel any stale streams
    for (const agent of targets) {
      await streamTo(set, get, conv, userMsg, agent);
    }
  },

  // Retry a failed assistant message: drop it and re-stream the last user
  // message before it to the same target agent (best-effort for group fan-out).
  async retryMessage(messageId) {
    const { messages } = get();
    const msg = messages.find((m) => m.id === messageId);
    if (!msg) return;
    if (msg.status !== "failed") {
      diagnostics.debug("chat.retry", "Retry ignored — the message is not in a failed state", { messageId, status: msg.status });
      return;
    }
    pendingRetries.delete(messageId);

    diagnostics.info("chat.retry", "Re-sending a failed turn", {
      messageId,
      reason: msg.errorText || "(unknown)",
      kind: msg.errorKind || "(unknown)",
      attempts: msg.attempts ?? 0,
    });

    set({ messages: messages.filter((m) => m.id !== messageId), lastError: null, error: null });
    await db.messages.delete(messageId);

    const userMsg = [...get().messages]
      .filter((m) => m.role === "user" && (m.id as number) < messageId)
      .reverse()[0];
    if (!userMsg) return;

    const conv = await db.conversations.get(msg.conversationId);
    if (!conv) return;
    await streamTo(set, get, conv, userMsg, msg.agentName || null);
  },

  // Stop all streaming, mark partial content as final.
  async stopStreaming() {
    diagnostics.info("chat.stop", "Stop requested — aborting in-flight streams");
    for (const t of retryTimers.values()) clearTimeout(t);
    retryTimers.clear();
    hermesClient.abort();
    const { messages } = get();
    for (const m of messages) {
      if (m.status === "streaming" && m.id != null) {
        await db.messages.update(m.id, { status: "done", content: m.content });
      }
    }
    set({
      messages: messages.map((m) => (m.status === "streaming" ? { ...m, status: "done", toolStatus: null } : m)),
      activeStreams: 0,
      error: null,
    });
  },

  // Probe the gateway right now (the connection pill's tap handler).
  async checkConnection() {
    if (!connectionMonitor) return;
    diagnostics.debug("health", "Manual health check requested");
    const result = await connectionMonitor.checkNow();
    set({ connectionDetail: `${result.reason} · ${result.tookMs}ms` });
    if (result.reachable) set({ connectionStatus: "connected" });
  },

  // Set custom base URL
  async setBaseUrl(url) {
    diagnostics.info("chat.config", "Base URL changed", { url });
    set({ baseUrl: url });
    hermesClient.setBaseUrl(url);
    await db.settings.put({ key: "baseUrl", value: url });
    await get().checkConnection();
  },

  // Set API key
  async setApiKey(key) {
    diagnostics.info("chat.config", "API key updated", { length: key.length });
    set({ apiKey: key });
    hermesClient.setApiKey(key);
    await db.settings.put({ key: "apiKey", value: key });
    // A new key changes what the gateway will accept — re-probe immediately so
    // a stale "API key rejected" state clears the moment it is fixed.
    await get().checkConnection();
  },

  // ── Slash commands ─────────────────────────────────────────────────────

  commandHelp() {
    const lines = COMMANDS.map((c) => `  ${c.cmd}  —  ${c.desc}`).join("\n");
    return `Chat commands\n\n${lines}\n\nType a slash command in the input to run it. @mention an agent in a group to route the reply to them.`;
  },

  agentList() {
    const { agents } = get();
    const list = agents
      .map((a) => {
        const extra = a.displayName && a.displayName !== titleCase(a.name) ? ` (${a.displayName})` : "";
        const desc = a.description ? ` — ${a.description}` : "";
        return `  @${a.name}${extra}${desc}`;
      })
      .join("\n");
    return list ? `Available agents\n\n${list}\n\nUse /dm <name> to message one, or /group a, b to start a group.` : "No agents configured yet — add them in Settings.";
  },

  // Inject a local "system" reply bubble (command output). Not routed to any
  // agent, excluded from agent context, and rendered as muted helper text.
  async pushSystem(text) {
    const { activeConversationId } = get();
    let conv = activeConversationId ? await db.conversations.get(activeConversationId) : null;
    if (!conv) {
      const id = await db.conversations.add({
        title: "New Chat",
        lastMessage: "",
        updatedAt: Date.now(),
        kind: "default",
        agentIds: [],
        messageCount: 0,
        sessions: {},
        projectId: activeScope(),
      });
      set({ activeConversationId: id });
      conv = await db.conversations.get(id);
    }
    if (!conv) return;
    const msg: ChatMessage = {
      conversationId: conv.id as number,
      role: "assistant",
      system: true,
      content: text,
      status: "done",
      createdAt: Date.now(),
      agentName: null,
    };
    const id = await db.messages.add(msg);
    msg.id = id;
    set({ messages: [...get().messages, msg] });
    await db.conversations.update(conv.id as number, {
      lastMessage: text.slice(0, 80),
      updatedAt: Date.now(),
    });
    await get().recountMessageCount(conv.id as number);
  },

  // Delete all messages in the active conversation (keeps the conversation row).
  async clearConversation() {
    const { activeConversationId } = get();
    if (!activeConversationId) return;
    await db.messages.where("conversationId").equals(activeConversationId).delete();
    set({ messages: [] });
    await get().recountMessageCount(activeConversationId);
  },

  // Parse and run a slash command. Returns true if the input was consumed
  // (anything starting with "/"); false if it's ordinary chat text.
  async runCommand(raw) {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("/")) return false;
    const [cmd, ...rest] = trimmed.split(/\s+/);
    const arg = rest.join(" ").trim();
    const { agents, pushSystem, newDirectMessage, newGroupConversation, activeConversationId, renameConversation } = get();

    switch (cmd.toLowerCase()) {
      case "/new":
        await get().newConversation();
        return true;
      case "/clear":
        await get().clearConversation();
        await pushSystem("Conversation cleared.");
        return true;
      case "/help":
        await pushSystem(get().commandHelp());
        return true;
      case "/agents":
        await pushSystem(get().agentList());
        return true;
      case "/dm": {
        const want = (arg || "").replace(/^@/, "").toLowerCase();
        const agent = agents.find((a) => a.name.toLowerCase() === want);
        if (!agent) {
          await pushSystem(`Unknown agent "${arg}". Try /agents to list them.`);
        } else {
          await newDirectMessage(agent.name);
        }
        return true;
      }
      case "/group": {
        if (!arg) {
          await pushSystem("Usage: /group agent1, agent2, …");
          return true;
        }
        const names = arg
          .split(/[,\s]+/)
          .map((n) => n.replace(/^@/, "").toLowerCase())
          .filter(Boolean);
        const found = names.map((n) => agents.find((a) => a.name.toLowerCase() === n)).filter(Boolean) as Array<Agent>;
        if (found.length === 0) {
          await pushSystem("No matching agents. Try /agents to list them.");
          return true;
        }
        await newGroupConversation(found.map((a) => a.name));
        return true;
      }
      case "/rename": {
        if (!activeConversationId) {
          await pushSystem("Open a conversation first to rename it.");
          return true;
        }
        if (!arg) {
          await pushSystem("Usage: /rename My new title");
          return true;
        }
        await renameConversation(activeConversationId, arg);
        await pushSystem(`Renamed to "${arg}".`);
        return true;
      }
      default:
        await pushSystem(`Unknown command "${cmd}". Try /help to list commands.`);
        return true;
    }
  },

  resetAll() {
    set({ messages: [], conversations: [], activeConversationId: null });
  },
}));

// ---------------------------------------------------------------------------
// Helpers that need both `set` and `get` but aren't part of the public store
// surface (mirrors private closures in the original Pinia setup-store).
// ---------------------------------------------------------------------------

// Ensure this conversation has a Hermes session id for the given agent,
// minting and persisting one if missing. The gateway persists every turn
// under this id, which is what makes history follow across devices.
async function ensureSession(conv: Conversation, agentName: string | null | undefined): Promise<string> {
  const key = agentKeyName(agentName);
  const sessions = { ...(conv.sessions || {}) };
  if (!sessions[key]) {
    sessions[key] = `talaria-${agentName || "default"}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    conv.sessions = sessions;
    await db.conversations.update(conv.id as number, { sessions });
  }
  return sessions[key];
}

// Stream a single agent reply. Builds context from the stored conversation
// (stable under concurrent fan-out), appends its own placeholder message
// tagged with the agent name, and routes the request to /p/<agent>/.
//
// Retry policy (rewritten — the old ladder retried everything 3× with a fixed
// delay and appended each attempt's text onto the previous attempt's):
//   - only RETRIABLE transport failures are retried (a 401/403/404 fails
//     identically every time — retrying just costs the user 12 seconds);
//   - at most MAX_ATTEMPTS, exponential backoff with jitter;
//   - a retry REPLACES the attempt's content instead of concatenating;
//   - once any text has arrived we stop retrying and show the partial reply
//     with the reason, so a long turn is never silently re-spent.
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1500;
const RETRY_MAX_DELAY_MS = 10_000;

function backoffMs(attempt: number): number {
  const base = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
  return Math.min(base, RETRY_MAX_DELAY_MS) + Math.floor(Math.random() * 500);
}

async function streamTo(
  set: (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState,
  conv: Conversation,
  userMsg: ChatMessage | null,
  agentName: string | null | undefined
) {
  const conversationId = conv.id as number;
  const scope = `chat.${agentKeyName(agentName)}`;
  const sessionId = await ensureSession(conv, agentName);
  const assistantMsg: ChatMessage = {
    conversationId,
    role: "assistant",
    content: "",
    status: "streaming",
    createdAt: Date.now(),
    startedAt: Date.now(),
    elapsedMs: null,
    tokens: null,
    contextTokens: null,
    modelName: null,
    agentName: agentName || null,
    attempts: 1,
  };
  const assistantId = (await db.messages.add(assistantMsg)) as number;
  assistantMsg.id = assistantId;
  set({ messages: [...get().messages, assistantMsg] });

  // Resolve the model for this turn: a per-conversation override wins,
  // otherwise the agent's configured model. Override sends provider too so
  // the gateway honors a bare model value.
  const overrideModel = conv?.model || null;
  const overrideProvider = overrideModel ? get().providerFor(overrideModel) : "";
  assistantMsg.modelName = overrideModel || get().agentModel(agentName) || null;
  patchMessage(set, get, assistantId, { modelName: assistantMsg.modelName });

  // Context = stored messages for this conversation (placeholders + failed
  // rows excluded), last 50.
  const stored = await db.messages.where("conversationId").equals(conversationId).sortBy("createdAt");
  const context = stored
    .filter((m) => m.status !== "streaming" && m.status !== "failed" && !m.system)
    .slice(-50)
    .map((m) => ({ role: m.role, content: m.content }));

  set({ activeStreams: get().activeStreams + 1 });

  let attempts = 0;
  let cancelled = false;
  const current = () => get().messages.find((m) => m.id === assistantId);
  const partialText = () => (current()?.content || "").trim();
  const setTimer = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      retryTimers.delete(assistantId);
      if (!cancelled) fn();
    }, ms);
    retryTimers.set(assistantId, t);
    return t;
  };

  const finish = async (status: "done" | "failed", failure?: ChatFailure) => {
    if (cancelled) return;
    cancelled = true;
    const pending = retryTimers.get(assistantId);
    if (pending) clearTimeout(pending);
    retryTimers.delete(assistantId);
    const msg = current();
    if (!msg) return;
    const elapsedMs = status === "done" && msg.content ? Date.now() - (msg.startedAt || Date.now()) : msg.elapsedMs;
    patchMessage(set, get, assistantId, { status, elapsedMs, toolStatus: null });
    set({ activeStreams: Math.max(0, get().activeStreams - 1) });
    const updated = current();
    await db.messages.update(assistantId, {
      content: updated?.content,
      status,
      startedAt: updated?.startedAt,
      elapsedMs: updated?.elapsedMs,
      tokens: updated?.tokens,
      contextTokens: updated?.contextTokens,
      modelName: updated?.modelName,
      errorKind: failure?.kind ?? null,
      errorText: failure?.message ?? null,
      retriable: failure?.retriable ?? null,
      attempts: updated?.attempts ?? attempts,
    });
    if (status === "done") {
      await db.conversations.update(conversationId, {
        lastMessage: (updated?.content || "").slice(0, 80),
        updatedAt: Date.now(),
      });
      await get().recountMessageCount(conversationId);
    }
    // Observability (M1): surface a live activity event for this agent turn so
    // the feed/timeline streams real agent work as it happens. Scoped to the
    // conversation's project (P9). Chat replies are intent, not artifacts (P3),
    // so no artifact is attached — the UI renders them as unverified claims.
    if (agentName && (status === "failed" || (updated?.content || "").trim())) {
      useObservabilityStore
        .getState()
        .record({
          agent: agentName,
          projectId: conv.projectId ?? null,
          kind: "action",
          action: "replied to a message",
          summary: status === "failed" ? `failed: ${failure?.message ?? "unknown"}` : (updated?.content || "").slice(0, 200),
          status,
          streamId: `conv-${conversationId}`,
        })
        .catch(() => {});
    }
  };

  // One failed attempt: retry the transient ones, otherwise explain and stop.
  const onAttemptFailed = async (raw: unknown) => {
    const err = raw instanceof StreamError ? raw : new StreamError("network", String((raw as Error)?.message || raw), { detail: JSON.stringify(describeError(raw)) });
    const failure: ChatFailure = {
      kind: err.kind,
      message: err.message,
      detail: err.detail,
      retriable: err.retriable,
      at: Date.now(),
    };
    if (err.kind === "aborted") {
      // The user pressed Stop (or a newer send superseded this one): keep
      // whatever text arrived and settle the bubble — never a failure state.
      diagnostics.info(scope, "Turn stopped by the user", { chars: partialText().length });
      await finish("done");
      return;
    }
    set({ lastError: failure, error: err.message });
    diagnostics.warn(scope, `Attempt ${attempts}/${MAX_ATTEMPTS} failed: ${err.message}`, {
      kind: err.kind,
      status: err.status,
      detail: err.detail,
      receivedChars: partialText().length,
      retriable: err.retriable,
    });

    if (err.retriable && !partialText() && attempts < MAX_ATTEMPTS) {
      const delay = backoffMs(attempts);
      set({ connectionStatus: "reconnecting", error: `Reconnecting… (attempt ${attempts + 1}/${MAX_ATTEMPTS})` });
      diagnostics.debug(scope, `Retrying in ${delay}ms`, { attempt: attempts + 1, of: MAX_ATTEMPTS });
      setTimer(() => void attempt(), delay);
      return;
    }

    // Terminal for this turn.
    if (err.kind === "network" || err.kind === "timeout" || err.kind === "stall" || err.kind === "server") {
      set({ connectionStatus: "reconnecting" });
    }
    if (err.retriable && !partialText()) {
      // Re-send automatically once the gateway proves it is back (see
      // flushPendingRetries) — the user should rarely have to tap Retry.
      pendingRetries.add(assistantId);
    }
    await finish("failed", failure);
  };

  const attempt = async () => {
    attempts++;
    patchMessage(set, get, assistantId, { status: "streaming", attempts, toolStatus: null });
    await hermesClient.streamChat(
      context,
      {
        onToken(text) {
          const msg = current();
          if (msg) patchMessage(set, get, assistantId, { content: (msg.content || "") + text, toolStatus: null });
        },
        onToolProgress(progress) {
          const line =
            progress.status === "running"
              ? `${progress.emoji || "🔧"} ${progress.label || progress.tool || "working"}`
              : null;
          if (line) diagnostics.debug(scope, `Tool running: ${line}`);
          patchMessage(set, get, assistantId, { toolStatus: line });
        },
        onUsage(usage) {
          const t = usage.total_tokens != null ? usage.total_tokens : usage.completion_tokens;
          const patch: Partial<ChatMessage> = {};
          if (t != null) patch.tokens = t;
          // prompt_tokens = real input context size for this request.
          if (usage.prompt_tokens != null) patch.contextTokens = usage.prompt_tokens;
          if (Object.keys(patch).length) patchMessage(set, get, assistantId, patch);
        },
        async onDone() {
          set({ connectionStatus: "connected", lastError: null, error: null });
          await finish("done");
          // Auto-title on first user message of a fresh conversation.
          const freshConv = await db.conversations.get(conversationId);
          if (freshConv && freshConv.title === "New Chat" && userMsg) {
            const t = userMsg.content.slice(0, 40) + (userMsg.content.length > 40 ? "…" : "");
            await db.conversations.update(conversationId, { title: t });
          }
        },
        onError(err) {
          return onAttemptFailed(err);
        },
        onSessionId(sid) {
          if (sid) {
            const key = agentKeyName(agentName);
            const sessions = { ...(conv.sessions || {}) };
            sessions[key] = sid;
            conv.sessions = sessions;
            db.conversations.update(conversationId, { sessions });
          }
        },
      },
      {
        agent: agentName,
        apiKey: get().agentKey(agentName),
        sessionId,
        model: overrideModel || undefined,
        provider: overrideProvider || undefined,
        label: agentKeyName(agentName),
      }
    );
  };

  diagnostics.info(scope, "Turn started", {
    conversationId,
    sessionId,
    model: assistantMsg.modelName || "(profile default)",
    contextMessages: context.length,
  });
  await attempt();
}

// Timers for scheduled retries, keyed by assistant message id, so Stop and
// teardown can cancel pending attempts.
const retryTimers = new Map<number, ReturnType<typeof setTimeout>>();

// Turns that failed for a retriable reason with nothing received yet: re-sent
// automatically the moment the gateway proves it is reachable again.
const pendingRetries = new Set<number>();

async function flushPendingRetries(
  set: (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState
): Promise<void> {
  if (pendingRetries.size === 0) return;
  if (get().isStreaming()) return; // don't stack turns on top of a live stream
  const ids = [...pendingRetries];
  pendingRetries.clear();
  diagnostics.info("chat.retry", `Reconnected — re-sending ${ids.length} failed turn(s)`, { ids });
  for (const id of ids) {
    await get().retryMessage(id);
  }
  void set;
}

function patchMessage(
  set: (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState,
  id: number,
  patch: Partial<ChatMessage>
) {
  set({ messages: get().messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
}

// Parse our session-id convention "talaria-<agent>-<ts>-<rand>" to recover
// which agent (profile) a server session belongs to.
function parseTalariaSession(id: string, agents: Array<Agent>): { agent: string | null } | null {
  if (typeof id !== "string" || !id.startsWith("talaria-")) return null;
  const rest = id.slice("talaria-".length);
  const names = ["default", ...agents.map((a) => a.name)];
  let found: string | null = null;
  for (const n of names) {
    if (rest === n || rest.startsWith(`${n}-`)) {
      if (!found || n.length > found.length) found = n;
    }
  }
  if (!found) return null;
  return { agent: found === "default" ? null : found };
}

// Auto-provision REAL per-profile API keys from the local host's config
// endpoint so every agent works out of the box (no fabricated values).
// Reads /talaria-config served by serve.mjs; harmless if absent (remote host).
async function applyServerConfig(
  set: (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState
) {
  try {
    const r = await fetch("/talaria-config");
    if (!r.ok) {
      diagnostics.warn("chat.config", `/talaria-config returned HTTP ${r.status} — per-profile API keys not provisioned (agent DMs will 401)`);
      return;
    }
    const cfg = await r.json();
    if (cfg.agents) {
      for (const [name, key] of Object.entries(cfg.agents) as Array<[string, string]>) {
        const agent = get().agents.find((a) => a.name === name);
        if (agent && !agent.apiKey && key) {
          await db.agents.update(name, { apiKey: key });
        }
      }
      await get().loadAgents();
    }
    if (cfg.base && !get().apiKey) {
      set({ apiKey: cfg.base });
      hermesClient.setApiKey(cfg.base);
      await db.settings.put({ key: "apiKey", value: cfg.base });
    }
    // Capture each profile's configured model (the real "configured in
    // hermes" set) so the app can show the current LLM and offer a dropdown.
    if (cfg.models) {
      const map: Record<string, ModelInfo> = {};
      for (const [name, info] of Object.entries(cfg.models) as Array<[string, { model?: string; provider?: string; contextLength?: number }]>) {
        if (info?.model) {
          map[name] = {
            model: info.model,
            provider: info.provider || "",
            contextLength: info.contextLength || null,
          };
        }
      }
      if (Object.keys(map).length) set({ modelsMap: map });
    }
    // Which model-providers have credentials on this host (from .env).
    if (Array.isArray(cfg.modelProviders)) {
      set({ availableModelProviders: cfg.modelProviders });
    }
  } catch (err) {
    // Not served by a Talaria config endpoint — e.g. a remote/public host.
    // This is the #1 cause of "agent chats 401 but the default profile works":
    // without per-profile keys every /p/<agent>/ request is rejected.
    diagnostics.warn(
      "chat.config",
      "Could not read /talaria-config — per-profile API keys are NOT provisioned here (agent DMs will fail with 401 unless keys were set in Settings)",
      describeError(err)
    );
  }
}

// Rebuild Talaria conversations from the gateway's persisted sessions so a
// fresh device's sidebar matches what was chatted elsewhere (works because
// history is NOT per-browser — it's in the gateway's session store). Scans
// BOTH the default profile AND every configured agent profile: DMs/groups
// are stored under each profile's own session store, so they'd otherwise
// never surface in a fresh browser (no local IndexedDB to seed from).
async function discoverServerConversations(get: () => ChatState) {
  const { agents, agentKey, agentDisplay } = get();
  const profiles: Array<string | null> = [null, ...agents.map((a) => a.name)];
  const seen = new Set<string>();
  let changed = false;
  for (const profile of profiles) {
    let list: Awaited<ReturnType<typeof hermesClient.listSessions>> = [];
    try {
      list = await hermesClient.listSessions(profile, { apiKey: agentKey(profile) });
    } catch (err) {
      diagnostics.warn("chat.discover", `Could not list sessions for ${profile ?? "default"}`, describeError(err));
      list = [];
    }
    for (const s of list || []) {
      const parsed = parseTalariaSession(s.id, agents);
      if (!parsed) continue;
      const agent = parsed.agent;
      const key = agentKeyName(agent);
      const uniq = `${key}|${s.id}`;
      if (seen.has(uniq)) continue;
      seen.add(uniq);
      const exists = await db.conversations.filter((c) => !!c.sessions && c.sessions[key] === s.id).toArray();
      if (exists.length) continue;
      await db.conversations.add({
        title: s.title || (agent ? agentDisplay(agent) || "New Chat" : "New Chat"),
        lastMessage: s.preview || "",
        updatedAt: typeof s.last_active === "number" ? s.last_active : Date.now(),
        kind: agent ? "dm" : "default",
        agentIds: agent ? [agent] : [],
        messageCount: s.message_count || (s.preview ? 1 : 0),
        sessions: { [key]: s.id },
      });
      changed = true;
    }
  }
  if (changed) await get().loadConversations();
}
