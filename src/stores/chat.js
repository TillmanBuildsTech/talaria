import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import db from '../db.js'
import { hermesClient, createConnectionMonitor } from '../services/hermes.js'

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
    if (!conv) return 'Hermes Chat'
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
    conversations.value = await db.conversations.orderBy('updatedAt').reverse().toArray()
    if (conversations.value.length > 0 && !activeConversationId.value) {
      activeConversationId.value = conversations.value[0].id
    }
  }

  // Load messages for active conversation
  async function loadMessages() {
    if (!activeConversationId.value) return
    messages.value = await db.messages
      .where('conversationId')
      .equals(activeConversationId.value)
      .sortBy('createdAt')
  }

  // Switch conversation
  async function switchConversation(id) {
    activeConversationId.value = id
    await loadMessages()
  }

  // Legacy standalone chat → routes to the gateway's default profile.
  async function newConversation() {
    const id = await db.conversations.add({
      title: 'New Chat',
      lastMessage: '',
      updatedAt: Date.now(),
      kind: 'default',
      agentIds: []
    })
    activeConversationId.value = id
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
        await switchConversation(conversations.value[0].id)
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
    const assistantMsg = {
      conversationId,
      role: 'assistant',
      content: '',
      status: 'streaming',
      createdAt: Date.now(),
      agentName: agentName || null
    }
    const assistantId = await db.messages.add(assistantMsg)
    assistantMsg.id = assistantId
    messages.value.push(assistantMsg)
    const index = messages.value.length - 1

    // Context = stored messages for this conversation (placeholders + failed
    // rows excluded), last 50.
    const stored = await db.messages
      .where('conversationId')
      .equals(conversationId)
      .sortBy('createdAt')
    const context = stored
      .filter(m => m.status !== 'streaming' && m.status !== 'failed')
      .slice(-50)
      .map(m => ({ role: m.role, content: m.content }))

    activeStreams.value++

    let retries = 0
    const maxRetries = 3
    const retryDelay = 2000

    const finish = async (status) => {
      messages.value[index].status = status
      activeStreams.value = Math.max(0, activeStreams.value - 1)
      await db.messages.update(assistantId, {
        content: messages.value[index].content,
        status
      })
      if (status === 'done') {
        await db.conversations.update(conversationId, {
          lastMessage: messages.value[index].content.slice(0, 80),
          updatedAt: Date.now()
        })
      }
    }

    const attempt = async () => {
      try {
        await hermesClient.streamChat(context, {
          onToken(text) {
            messages.value[index].content += text
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
          }
        }, { agent: agentName, apiKey: agentKey(agentName) })
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
    if (!activeConversationId.value) await newConversation()

    const conv = await db.conversations.get(activeConversationId.value)
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
    await loadConversations()
    if (activeConversationId.value) {
      await loadMessages()
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
    switchConversation,
    newConversation,
    newDirectMessage,
    newGroupConversation,
    deleteConversation,
    sendMessage,
    retryMessage,
    stopStreaming,
    setBaseUrl,
    setApiKey
  }
})