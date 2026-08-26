import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import db from '../db.js'
import { hermesClient, createConnectionMonitor } from '../services/hermes.js'
import { KNOWN_MODELS, knownWindowFor } from '../models.js'

// Parse @mentions in a group message against the conversation's member agents.
// Returns the matched member profile names (lowercased lookup) plus 'all' if
// @all was used.
function parseMentions(content, members) {
  const found = []
  const re = /@([A-Za-z0-9][A-Za-z0-9_-]*)/g
  let m
  while ((m = re.exec(content))) {
    const token = m[1].toLowerCase()
    if (token === 'all') {
      if (!found.includes('all')) found.push('all')
      continue
    }
    const member = members.find(mem => mem.toLowerCase() === token)
    if (member && !found.includes(member)) found.push(member)
  }
  return found
}

// Decide which agent(s) an outgoing message is routed to.
//   default conv → [null]            (gateway default profile, /v1/chat/completions)
//   dm           → [that agent]
//   group        → every member who was @mentioned; @all → all members;
//                  unaddressed → the group's primary (first) member.
function resolveTargets(conv, content) {
  const members = (conv && (conv.agentIds || [])).filter(Boolean)
  if (!conv || conv.kind !== 'group' || members.length === 0) {
    return [members[0] || null]
  }
  const mentions = parseMentions(content, members)
  if (mentions.includes('all')) {
    return members
  }
  const named = mentions.filter(n => n !== 'all')
  return named.length > 0 ? named : [members[0]]
}

export const useChatStore = defineStore('chat', () => {
  // ── State ──────────────────────────────────────────────────────────────
  const messages = ref([])
  const conversations = ref([])
  const agents = ref([])
  // agentName -> { model, provider, contextLength } (from /talaria-config;
  // the models Hermes is actually configured to run per profile).
  const modelsMap = ref({})
  // Model providers the host has credentials for (from /talaria-config, read
  // from the host's .env files). Only their models are shown in the dropdown.
  const availableModelProviders = ref([])
  const DEFAULT_CONTEXT_WINDOW = 128000
  const activeConversationId = ref(null)
  const connectionStatus = ref('connected') // 'connected' | 'reconnecting' | 'offline'
  const baseUrl = ref('/api/v1')
  const apiKey = ref(typeof __HERMES_API_KEY__ !== 'undefined' ? __HERMES_API_KEY__ : '')
  const error = ref(null)
  // Count of in-flight streams (group fan-out can have several at once).
  const activeStreams = ref(0)

  let connectionMonitor = null

  // ── Computed ───────────────────────────────────────────────────────────
  const isOnline = computed(() => connectionStatus.value !== 'offline')
  const isStreaming = computed(() => activeStreams.value > 0)
  const canSend = computed(() => !isStreaming.value)

  // Only conversations that actually have messages appear in the sidebar —
  // a brand-new (untitled, unsent) chat is hidden until something is said.
  const sidebarConversations = computed(() =>
    conversations.value.filter(c => (c.messageCount || 0) > 0)
  )

  // Friendly display name for an agent (profile) name.
  function agentDisplay(name) {
    if (!name) return null
    const a = agents.value.find(x => x.name === name)
    return (a && a.displayName) || titleCase(name)
  }
  function agentColor(name) {
    const a = agents.value.find(x => x.name === name)
    return (a && a.color) || '#64748b'
  }

  // Map an agent name to a stable conversation key ("default" for no prefix).
  function agentKeyName(agentName) {
    return agentName || 'default'
  }

  // Ensure this conversation has a Hermes session id for the given agent,
  // minting and persisting one if missing. The gateway persists every turn
  // under this id, which is what makes history follow across devices.
  async function ensureSession(conv, agentName) {
    const key = agentKeyName(agentName)
    const sessions = { ...(conv.sessions || {}) }
    if (!sessions[key]) {
      sessions[key] =
        `talaria-${agentName || 'default'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      conv.sessions = sessions
      await db.conversations.update(conv.id, { sessions })
    }
    return sessions[key]
  }

  // Per-agent API key (multiplex scopes API_SERVER_KEY per profile). Falls back
  // to the global key (the default profile's) when an agent has none stored.
  function agentKey(name) {
    if (!name) return apiKey.value
    const a = agents.value.find(x => x.name === name)
    return (a && a.apiKey) || apiKey.value
  }

  function titleCase(s) {
    return s.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }

  // Title for a conversation: DM → agent display name, group → joined names.
  function convTitle(conv) {
    if (!conv) return 'Talaria'
    if (conv.kind === 'group') {
      const names = (conv.agentIds || []).map(agentDisplay).filter(Boolean)
      return names.length ? names.join(', ') : conv.title
    }
    if (conv.kind === 'dm' && conv.agentIds && conv.agentIds.length) {
      return agentDisplay(conv.agentIds[0])
    }
    return conv.title
  }

  const activeConvTitle = computed(() => {
    const conv = conversations.value.find(c => c.id === activeConversationId.value)
    return convTitle(conv)
  })

  // Model dropdown list: the curated realistic catalog (models Hermes supports
  // on the in-use providers) PLUS each profile's configured default. Deduped by
  // model id so per-profile entries that match the catalog collapse into one.
  const configuredModels = computed(() => {
    const out = {}
    const add = (model, provider, ctx) => {
      if (!model) return
      const cur = out[model]
      out[model] = {
        model,
        provider: (cur && cur.provider) || provider || '',
        contextLength: (cur && cur.contextLength) || ctx || null
      }
    }
    // Only offer catalog models whose provider actually has a credential on
    // the host (those are the ones that will run). Unknown host → show all.
    const gated = availableModelProviders.value.length > 0
    for (const km of KNOWN_MODELS) {
      if (gated && !availableModelProviders.value.includes(km.provider)) continue
      add(km.model, km.provider, km.contextLength)
    }
    for (const info of Object.values(modelsMap.value)) {
      if (info && info.model) add(info.model, info.provider, info.contextLength)
    }
    return Object.values(out).sort((a, b) => a.model.localeCompare(b.model))
  })
  function contextWindowFor(model) {
    if (!model) return DEFAULT_CONTEXT_WINDOW
    const c = configuredModels.value.find(m => m.model === model)
    return (c && c.contextLength) || knownWindowFor(model) || DEFAULT_CONTEXT_WINDOW
  }
  function providerFor(model) {
    if (!model) return ''
    const c = configuredModels.value.find(m => m.model === model)
    return (c && c.provider) || ''
  }
  // Configured model for an agent (profile) — no override involved.
  function agentModel(name) {
    const i = modelsMap.value[name]
    return (i && i.model) || null
  }

  // Real input context size of the last assistant reply in the active
  // conversation — i.e. how many prompt tokens the next request will cost.
  const activeContextTokens = computed(() => {
    for (let i = messages.value.length - 1; i >= 0; i--) {
      const m = messages.value[i]
      if (m.role === 'assistant' && m.contextTokens != null && !m.system) return m.contextTokens
    }
    return 0
  })
  // Effective model for the active conversation: a user-set override, else the
  // active agent's configured model.
  const activeModelName = computed(() => {
    if (!activeConversationId.value) return null
    const conv = conversations.value.find(c => c.id === activeConversationId.value)
    if (!conv) return null
    if (conv.model) return conv.model
    const agent = (conv.agentIds && conv.agentIds[0]) || null
    return agentModel(agent)
  })
  const activeContextWindow = computed(() => contextWindowFor(activeModelName.value || ''))

  // Set (or clear, null) a per-conversation model override.
  function setConversationModel(modelName) {
    if (!activeConversationId.value) return
    const m = (modelName || '').trim() || null
    const conv = conversations.value.find(c => c.id === activeConversationId.value)
    if (conv) conv.model = m
    db.conversations.update(activeConversationId.value, { model: m })
  }

  // Members of the active group conversation (for mention chips/hints).
  const activeGroupMembers = computed(() => {
    const conv = conversations.value.find(c => c.id === activeConversationId.value)
    if (!conv || conv.kind !== 'group' || !(conv.agentIds || []).length) return []
    return conv.agentIds
  })

  // ── Actions ────────────────────────────────────────────────────────────

  async function loadAgents() {
    agents.value = await db.agents.orderBy('sort').toArray()
  }

  async function addAgent({ name, displayName, color, description, apiKey }) {
    if (!name) return null
    // Upsert: preserve color/sort when editing an existing agent.
    const existing = await db.agents.get(name)
    const sort = existing ? existing.sort : (await db.agents.count()) + 1
    await db.agents.put({
      name,
      displayName: displayName || (existing && existing.displayName) || titleCase(name),
      color: color || (existing && existing.color) || pickColor(sort),
      description: description !== undefined ? description : (existing && existing.description) || '',
      apiKey: apiKey !== undefined ? apiKey : (existing && existing.apiKey) || '',
      sort
    })
    await loadAgents()
  }

  async function removeAgent(name) {
    await db.agents.delete(name)
    await loadAgents()
  }

  function pickColor(i) {
    const palette = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#fb7185', '#f472b6', '#f87171', '#60a5fa']
    return palette[i % palette.length]
  }

  // Load conversations list from IndexedDB
  async function loadConversations() {
    const list = await db.conversations.orderBy('updatedAt').reverse().toArray()
    for (const c of list) {
      const n = await db.messages.where('conversationId').equals(c.id).count()
      // Server-discovered conversations carry a server message_count but no
      // local rows yet (messages load from the gateway when opened) — don't
      // clobber their known count down to 0, which would hide them from the
      // sidebar. Local rows win once they exist (e.g. after opening a chat).
      c.messageCount = n > 0 ? n : (c.messageCount || 0)
    }
    conversations.value = list
    if (!activeConversationId.value) {
      const firstReal = list.find(c => (c.messageCount || 0) > 0)
      if (firstReal) activeConversationId.value = firstReal.id
    }
  }

  // Refresh a conversation's message count (drives sidebar visibility).
  async function recountMessageCount(id) {
    const n = await db.messages.where('conversationId').equals(id).count()
    const conv = conversations.value.find(c => c.id === id)
    if (conv && conv.messageCount !== n) {
      conv.messageCount = n
      await db.conversations.update(id, { messageCount: n })
    }
  }

  // Rename a conversation (editable title).
  async function renameConversation(id, title) {
    const t = (title || '').trim()
    if (!t) return
    const conv = conversations.value.find(c => c.id === id)
    if (conv) conv.title = t
    await db.conversations.update(id, { title: t })
  }

  // Load messages for active conversation
  async function loadMessages() {
    if (!activeConversationId.value) return
    messages.value = await db.messages
      .where('conversationId')
      .equals(activeConversationId.value)
      .sortBy('createdAt')
  }

  // Restore a conversation's history from the Hermes gateway (source of truth)
  // so the same chat shows up on every device. Replaces local rows with the
  // merged server timeline for the conversation's per-agent sessions.
  async function syncConversationFromServer(conv) {
    if (!conv || isStreaming.value) return
    const entries = Object.entries(conv.sessions || {})
    if (entries.length === 0) return

    const fetched = await Promise.all(entries.map(async ([key, sid]) => {
      const agentName = key === 'default' ? null : key
      try {
        const msgs = await hermesClient.fetchSessionMessages(agentName, sid, {
          apiKey: agentKey(agentName)
        })
        // Show only the user/assistant turns — filter internal tool/reasoning rows.
        return msgs
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({
            serverId: m.id,
            role: m.role,
            content: m.content || '',
            createdAt: m.timestamp || Date.now(),
            agentName
          }))
      } catch {
        return []
      }
    }))
    const flat = fetched.flat()
    if (flat.length === 0) return

    const seen = new Set()
    const merged = []
    for (const m of flat) {
      if (m.serverId && !seen.has(m.serverId)) {
        seen.add(m.serverId)
        merged.push(m)
      }
    }
    merged.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))

    // The server is authoritative — replace local rows for this conversation.
    await db.messages.where('conversationId').equals(conv.id).delete()
    for (const m of merged) {
      await db.messages.add({
        conversationId: conv.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        agentName: m.agentName,
        serverId: m.serverId,
        status: 'done',
        startedAt: m.createdAt,
        elapsedMs: null,
        tokens: null
      })
    }
    await loadMessages()
    await recountMessageCount(conv.id)
  }

  // Parse our session-id convention "talaria-<agent>-<ts>-<rand>" to recover
  // which agent (profile) a server session belongs to.
  function parseTalariaSession(id) {
    if (typeof id !== 'string' || !id.startsWith('talaria-')) return null
    const rest = id.slice('talaria-'.length)
    const names = ['default', ...agents.value.map(a => a.name)]
    let found = null
    for (const n of names) {
      if (rest === n || rest.startsWith(n + '-')) {
        if (!found || n.length > found.length) found = n
      }
    }
    if (!found) return null
    return { agent: found === 'default' ? null : found }
  }

  // Rebuild Talaria conversations from the gateway's persisted sessions so a
  // fresh device's sidebar matches what was chatted elsewhere (works because
  // history is NOT per-browser — it's in the gateway's session store). Scans
  // BOTH the default profile AND every configured agent profile: DMs/groups
  // are stored under each profile's own session store, so they'd otherwise
  // never surface in a fresh browser (no local IndexedDB to seed from).
  async function discoverServerConversations() {
    const profiles = [null, ...agents.value.map(a => a.name)]
    const seen = new Set()
    let changed = false
    for (const profile of profiles) {
      let list = []
      try {
        list = await hermesClient.listSessions(profile, { apiKey: agentKey(profile) })
      } catch { list = [] }
      for (const s of list || []) {
        const parsed = parseTalariaSession(s.id)
        // Adopt native talaria-* sessions OR desktop/CLI sessions explicitly
        // shared to Talaria (flagged `pinned` by the /talaria Hermes command).
        // Preserves the opt-in design: plain desktop/CLI sessions never
        // surface here unless a command deliberately shares them. A shared
        // session keeps its OWN id, so continuing stays on the SAME session
        // (no copy) — the two surfaces never diverge.
        if (!parsed && !s.pinned) continue
        const agent = parsed ? parsed.agent : (profile || null)
        const key = agentKeyName(agent)
        const uniq = key + '|' + s.id
        if (seen.has(uniq)) continue
        seen.add(uniq)
        const exists = await db.conversations
          .filter(c => c.sessions && c.sessions[key] === s.id)
          .toArray()
        if (exists.length) continue
        await db.conversations.add({
          title: s.title || (agent ? agentDisplay(agent) : 'New Chat'),
          lastMessage: s.preview || '',
          updatedAt: typeof s.last_active === 'number' ? s.last_active : Date.now(),
          kind: agent ? 'dm' : 'default',
          agentIds: agent ? [agent] : [],
          messageCount: s.message_count || (s.preview ? 1 : 0),
          sessions: { [key]: s.id }
        })
        changed = true
      }
    }
    if (changed) await loadConversations()
  }

  // Auto-provision REAL per-profile API keys from the local host's config
  // endpoint so every agent works out of the box (no fabricated values).
  // Reads /talaria-config served by serve.mjs; harmless if absent (remote host).
  async function applyServerConfig() {
    try {
      const r = await fetch('/talaria-config')
      if (!r.ok) return
      const cfg = await r.json()
      if (cfg.agents) {
        for (const [name, key] of Object.entries(cfg.agents)) {
          const agent = agents.value.find(a => a.name === name)
          if (agent && !agent.apiKey && key) {
            agent.apiKey = key
            await db.agents.update(name, { apiKey: key })
          }
        }
      }
      if (cfg.base && !apiKey.value) {
        apiKey.value = cfg.base
        hermesClient.setApiKey(cfg.base)
        await db.settings.put({ key: 'apiKey', value: cfg.base })
      }
      // Capture each profile's configured model (the real "configured in
      // hermes" set) so the app can show the current LLM and offer a dropdown.
      if (cfg.models) {
        const map = {}
        for (const [name, info] of Object.entries(cfg.models)) {
          if (info && info.model) {
            map[name] = {
              model: info.model,
              provider: info.provider || '',
              contextLength: info.contextLength || null
            }
          }
        }
        if (Object.keys(map).length) modelsMap.value = map
      }
      // Which model-providers have credentials on this host (from .env).
      if (Array.isArray(cfg.modelProviders)) {
        availableModelProviders.value = cfg.modelProviders
      }
    } catch {
      // Not served by a Talaria config endpoint — e.g. a remote/public host.
    }
  }

  // Switch conversation
  async function switchConversation(id) {
    activeConversationId.value = id
    await loadMessages()
    const conv = await db.conversations.get(id)
    await syncConversationFromServer(conv)
  }

  // New chat: an unsent draft — no DB row until the first message is sent, so
  // it stays out of the sidebar until then.
  async function newConversation() {
    activeConversationId.value = null
    messages.value = []
    await loadConversations()
  }

  // 1:1 with a specific agent (profile).
  async function newDirectMessage(agentName) {
    if (!agentName) return null
    // Reuse an existing DM with this agent if there is one.
    const existing = await db.conversations
      .filter(c => c.kind === 'dm' && c.agentIds && c.agentIds[0] === agentName)
      .first()
    const id = existing
      ? existing.id
      : await db.conversations.add({
          title: 'New Chat',
          lastMessage: '',
          updatedAt: Date.now(),
          kind: 'dm',
          agentIds: [agentName]
        })
    activeConversationId.value = id
    await loadMessages()
    await loadConversations()
    return id
  }

  // Group chat with the named agent profiles.
  async function newGroupConversation(agentNames) {
    const members = (agentNames || []).filter(Boolean)
    if (members.length < 1) return null
    // A single-member "group" degrades to a DM.
    if (members.length === 1) return newDirectMessage(members[0])
    const id = await db.conversations.add({
      title: 'New Chat',
      lastMessage: '',
      updatedAt: Date.now(),
      kind: 'group',
      agentIds: members
    })
    activeConversationId.value = id
    messages.value = []
    await loadConversations()
    return id
  }

  // Delete conversation
  async function deleteConversation(id) {
    await db.messages.where('conversationId').equals(id).delete()
    await db.conversations.delete(id)
    if (activeConversationId.value === id) {
      await loadConversations()
      if (conversations.value.length > 0) {
        const target = sidebarConversations.value[0] || conversations.value[0]
        await switchConversation(target.id)
      } else {
        activeConversationId.value = null
        messages.value = []
      }
    }
    await loadConversations()
  }

  // Stream a single agent reply. Builds context from the stored conversation
  // (stable under concurrent fan-out), appends its own placeholder message
  // tagged with the agent name, and routes the request to /p/<agent>/.
  async function _streamTo(conv, userMsg, agentName) {
    const conversationId = conv.id
    const sessionId = await ensureSession(conv, agentName)
    const assistantMsg = {
      conversationId,
      role: 'assistant',
      content: '',
      status: 'streaming',
      createdAt: Date.now(),
      startedAt: Date.now(),
      elapsedMs: null,
      tokens: null,
      contextTokens: null,
      modelName: null,
      agentName: agentName || null
    }
    const assistantId = await db.messages.add(assistantMsg)
    assistantMsg.id = assistantId
    messages.value.push(assistantMsg)
    const index = messages.value.length - 1

    // Resolve the model for this turn: a per-conversation override wins,
    // otherwise the agent's configured model. Override sends provider too so
    // the gateway honors a bare model value.
    const overrideModel = (conv && conv.model) || null
    const overrideProvider = overrideModel ? providerFor(overrideModel) : ''
    assistantMsg.modelName = overrideModel || agentModel(agentName) || null

    // Context = stored messages for this conversation (placeholders + failed
    // rows excluded), last 50.
    const stored = await db.messages
      .where('conversationId')
      .equals(conversationId)
      .sortBy('createdAt')
    const context = stored
      .filter(m => m.status !== 'streaming' && m.status !== 'failed' && !m.system)
      .slice(-50)
      .map(m => ({ role: m.role, content: m.content }))

    activeStreams.value++

    let retries = 0
    const maxRetries = 3
    const retryDelay = 2000

    const finish = async (status) => {
      messages.value[index].status = status
      activeStreams.value = Math.max(0, activeStreams.value - 1)
      if (status === 'done') {
        messages.value[index].elapsedMs = Date.now() - messages.value[index].startedAt
      }
      await db.messages.update(assistantId, {
        content: messages.value[index].content,
        status,
        startedAt: messages.value[index].startedAt,
        elapsedMs: messages.value[index].elapsedMs,
        tokens: messages.value[index].tokens,
        contextTokens: messages.value[index].contextTokens,
        modelName: messages.value[index].modelName
      })
      if (status === 'done') {
        await db.conversations.update(conversationId, {
          lastMessage: messages.value[index].content.slice(0, 80),
          updatedAt: Date.now()
        })
        await recountMessageCount(conversationId)
      }
    }

    const attempt = async () => {
      try {
        await hermesClient.streamChat(context, {
          onToken(text) {
            messages.value[index].content += text
          },
          onUsage(usage) {
            const t = usage && (usage.total_tokens != null ? usage.total_tokens : usage.completion_tokens)
            if (t != null) messages.value[index].tokens = t
            // prompt_tokens = real input context size for this request.
            if (usage && usage.prompt_tokens != null) messages.value[index].contextTokens = usage.prompt_tokens
          },
          async onDone() {
            connectionStatus.value = 'connected'
            await finish('done')
            // Auto-title on first user message of a fresh conversation.
            const conv = await db.conversations.get(conversationId)
            if (conv && conv.title === 'New Chat' && userMsg) {
              const t = userMsg.content.slice(0, 40) + (userMsg.content.length > 40 ? '…' : '')
              await db.conversations.update(conversationId, { title: t })
            }
          },
          async onError() {
            if (retries < maxRetries) {
              retries++
              connectionStatus.value = 'reconnecting'
              setTimeout(attempt, retryDelay * retries)
            } else {
              connectionStatus.value = 'offline'
              error.value = 'Connection lost. Tap to retry.'
              await finish('failed')
            }
          },
          onSessionId(sid) {
            if (sid) {
              const key = agentKeyName(agentName)
              const sessions = { ...(conv.sessions || {}) }
              sessions[key] = sid
              conv.sessions = sessions
              db.conversations.update(conversationId, { sessions })
            }
          }
        }, { agent: agentName, apiKey: agentKey(agentName), sessionId,
          model: overrideModel || undefined, provider: overrideProvider || undefined })
      } catch {
        // fetch-level failure (abort/no network): same retry ladder
        if (retries < maxRetries) {
          retries++
          connectionStatus.value = 'reconnecting'
          setTimeout(attempt, retryDelay * retries)
        } else {
          connectionStatus.value = 'offline'
          error.value = 'Connection lost. Tap to retry.'
          await finish('failed')
        }
      }
    }

    attempt()
  }

  // Send a message. Routes to one or more agents based on the conversation
  // kind and any @mentions; streams a reply from each target concurrently.
  async function sendMessage(content) {
    if (!content.trim() || isStreaming.value) return

    // Slash commands run locally against the app (store/session), never sent
    // to an agent. Everything starting with "/" is consumed here.
    if (content.trim().startsWith('/')) {
      await runCommand(content.trim())
      return
    }

    // Lazily create the conversation row on first send (absent for a draft).
    let conv = activeConversationId.value
      ? await db.conversations.get(activeConversationId.value)
      : null
    if (!conv) {
      const id = await db.conversations.add({
        title: 'New Chat',
        lastMessage: '',
        updatedAt: Date.now(),
        kind: 'default',
        agentIds: [],
        messageCount: 0,
        sessions: {}
      })
      activeConversationId.value = id
      conv = await db.conversations.get(id)
    }
    if (!conv) return

    const text = content.trim()
    error.value = null

    // 1. Optimistic user message
    const targets = resolveTargets(conv, text)
    const targetAgents = targets.filter(Boolean)
    const userMsg = {
      conversationId: conv.id,
      role: 'user',
      content: text,
      status: 'sent',
      createdAt: Date.now(),
      // Names of agents this message is addressed to (for mention badge).
      targetAgents
    }
    const userId = await db.messages.add(userMsg)
    userMsg.id = userId
    messages.value.push(userMsg)
    await recountMessageCount(conv.id)

    // 2. Update conversation metadata
    await db.conversations.update(conv.id, {
      lastMessage: text,
      updatedAt: Date.now()
    })

    connectionStatus.value = 'connected'

    // 3. Stream a reply from each target.
    hermesClient.abort() // cancel any stale streams
    for (const agent of targets) {
      await _streamTo(conv, userMsg, agent)
    }
  }

  // Retry a failed assistant message: drop it and re-stream the last user
  // message before it to the same target agent (best-effort for group fan-out).
  async function retryMessage(messageId) {
    const msg = messages.value.find(m => m.id === messageId)
    if (!msg || msg.status !== 'failed') return

    messages.value = messages.value.filter(m => m.id !== messageId)
    await db.messages.delete(messageId)

    const userMsg = [...messages.value]
      .filter(m => m.role === 'user' && m.id < messageId)
      .reverse()[0]
    if (!userMsg) return

    const conv = await db.conversations.get(msg.conversationId)
    if (!conv) return
    await _streamTo(conv, userMsg, msg.agentName || null)
  }

  // Stop all streaming, mark partial content as final.
  async function stopStreaming() {
    hermesClient.abort()
    for (const m of messages.value) {
      if (m.status === 'streaming') {
        m.status = 'done'
        await db.messages.update(m.id, { status: 'done', content: m.content })
      }
    }
    activeStreams.value = 0
    connectionStatus.value = 'connected'
  }

  // Set custom base URL
  async function setBaseUrl(url) {
    baseUrl.value = url
    hermesClient.setBaseUrl(url)
    await db.settings.put({ key: 'baseUrl', value: url })
  }

  // Set API key
  async function setApiKey(key) {
    apiKey.value = key
    hermesClient.setApiKey(key)
    await db.settings.put({ key: 'apiKey', value: key })
  }

  // Init: load state from DB
  async function init() {
    // Load saved base URL
    const savedUrl = await db.settings.get('baseUrl')
    if (savedUrl?.value) {
      baseUrl.value = savedUrl.value
      hermesClient.setBaseUrl(savedUrl.value)
    }

    // Load saved API key, fall back to build-injected default
    const savedKey = await db.settings.get('apiKey')
    if (savedKey?.value) {
      apiKey.value = savedKey.value
      hermesClient.setApiKey(savedKey.value)
    } else if (apiKey.value) {
      hermesClient.setApiKey(apiKey.value)
    }

    await loadAgents()
    // Fill agents with their real per-profile API keys (serve.mjs config).
    await applyServerConfig()
    await loadConversations()
    // Rebuild conversations from server sessions (cross-device sidebar).
    await discoverServerConversations()
    await loadConversations()
    if (activeConversationId.value) {
      await loadMessages()
      const conv = await db.conversations.get(activeConversationId.value)
      await syncConversationFromServer(conv)
    }

    // Start connection monitoring
    connectionMonitor = createConnectionMonitor({
      onOnline: () => {
        connectionStatus.value = 'connected'
      },
      onOffline: () => {
        connectionStatus.value = 'offline'
      }
    })
    connectionMonitor.startHealthChecks()

    // Initial status
    connectionStatus.value = navigator.onLine ? 'connected' : 'offline'
  }

  // Teardown
  function destroy() {
    if (connectionMonitor) connectionMonitor.destroy()
    hermesClient.abort()
  }

  // ── Slash commands ─────────────────────────────────────────────────────

  const COMMANDS = [
    { cmd: '/new', desc: 'Start a new (blank) chat' },
    { cmd: '/clear', desc: 'Clear this conversation’s messages' },
    { cmd: '/help', desc: 'Show this command list' },
    { cmd: '/agents', desc: 'List available agents' },
    { cmd: '/dm <name>', desc: 'Open a DM with an agent' },
    { cmd: '/group <a>, <b>', desc: 'Start a group chat' },
    { cmd: '/rename <title>', desc: 'Rename this conversation' }
  ]

  function commandHelp() {
    const lines = COMMANDS.map(c => `  ${c.cmd}  —  ${c.desc}`).join('\n')
    return 'Chat commands\n\n' + lines +
      '\n\nType a slash command in the input to run it. @mention an agent in a group to route the reply to them.'
  }

  function agentList() {
    const list = agents.value
      .map(a => {
        const extra = (a.displayName && a.displayName !== titleCase(a.name)) ? ` (${a.displayName})` : ''
        const desc = a.description ? ` — ${a.description}` : ''
        return `  @${a.name}${extra}${desc}`
      })
      .join('\n')
    return list ? `Available agents\n\n${list}\n\nUse /dm <name> to message one, or /group a, b to start a group.` : 'No agents configured yet — add them in Settings.'
  }

  // Inject a local "system" reply bubble (command output). Not routed to any
  // agent, excluded from agent context, and rendered as muted helper text.
  async function pushSystem(text) {
    let conv = activeConversationId.value
      ? await db.conversations.get(activeConversationId.value)
      : null
    if (!conv) {
      const id = await db.conversations.add({
        title: 'New Chat',
        lastMessage: '',
        updatedAt: Date.now(),
        kind: 'default',
        agentIds: [],
        messageCount: 0,
        sessions: {}
      })
      activeConversationId.value = id
      conv = await db.conversations.get(id)
    }
    if (!conv) return
    const msg = {
      conversationId: conv.id,
      role: 'assistant',
      system: true,
      content: text,
      status: 'done',
      createdAt: Date.now(),
      agentName: null
    }
    const id = await db.messages.add(msg)
    msg.id = id
    messages.value.push(msg)
    await db.conversations.update(conv.id, {
      lastMessage: text.slice(0, 80),
      updatedAt: Date.now()
    })
    await recountMessageCount(conv.id)
  }

  // Delete all messages in the active conversation (keeps the conversation row).
  async function clearConversation() {
    if (!activeConversationId.value) return
    await db.messages.where('conversationId').equals(activeConversationId.value).delete()
    messages.value = []
    await recountMessageCount(activeConversationId.value)
  }

  // Parse and run a slash command. Returns true if the input was consumed
  // (anything starting with "/"); false if it's ordinary chat text.
  async function runCommand(raw) {
    const trimmed = raw.trim()
    if (!trimmed.startsWith('/')) return false
    const [cmd, ...rest] = trimmed.split(/\s+/)
    const arg = rest.join(' ').trim()

    switch (cmd.toLowerCase()) {
      case '/new':
        await newConversation()
        return true
      case '/clear':
        await clearConversation()
        await pushSystem('Conversation cleared.')
        return true
      case '/help':
        await pushSystem(commandHelp())
        return true
      case '/agents':
        await pushSystem(agentList())
        return true
      case '/dm': {
        const want = (arg || '').replace(/^@/, '').toLowerCase()
        const agent = agents.value.find(a => a.name.toLowerCase() === want)
        if (!agent) {
          await pushSystem(`Unknown agent "${arg}". Try /agents to list them.`)
        } else {
          await newDirectMessage(agent.name)
        }
        return true
      }
      case '/group': {
        if (!arg) { await pushSystem('Usage: /group agent1, agent2, …'); return true }
        const names = arg.split(/[,\s]+/).map(n => n.replace(/^@/, '').toLowerCase()).filter(Boolean)
        const found = names.map(n => agents.value.find(a => a.name.toLowerCase() === n)).filter(Boolean)
        if (found.length === 0) { await pushSystem('No matching agents. Try /agents to list them.'); return true }
        await newGroupConversation(found.map(a => a.name))
        return true
      }
      case '/rename': {
        if (!activeConversationId.value) { await pushSystem('Open a conversation first to rename it.'); return true }
        if (!arg) { await pushSystem('Usage: /rename My new title'); return true }
        await renameConversation(activeConversationId.value, arg)
        await pushSystem(`Renamed to "${arg}".`)
        return true
      }
      default:
        await pushSystem(`Unknown command "${cmd}". Try /help to list commands.`)
        return true
    }
  }

  return {
    // state
    messages,
    conversations,
    agents,
    activeConversationId,
    isStreaming,
    connectionStatus,
    baseUrl,
    apiKey,
    error,
    activeStreams,
    // computed
    isOnline,
    canSend,
    activeConvTitle,
    activeGroupMembers,
    sidebarConversations,
    // context + model UI state
    activeContextTokens,
    activeModelName,
    activeContextWindow,
    configuredModels,
    contextWindowFor,
    setConversationModel,
    // helpers
    agentDisplay,
    agentColor,
    agentKey,
    convTitle,
    // actions
    init,
    destroy,
    loadAgents,
    addAgent,
    removeAgent,
    loadConversations,
    loadMessages,
    syncConversationFromServer,
    switchConversation,
    newConversation,
    newDirectMessage,
    newGroupConversation,
    deleteConversation,
    renameConversation,
    recountMessageCount,
    sendMessage,
    retryMessage,
    stopStreaming,
    setBaseUrl,
    setApiKey,
    // slash commands
    runCommand,
    clearConversation,
    pushSystem,
    COMMANDS,
    commandHelp
  }
})