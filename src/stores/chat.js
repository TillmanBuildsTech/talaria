import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import db from '../db.js'
import { hermesClient, createConnectionMonitor } from '../services/hermes.js'

export const useChatStore = defineStore('chat', () => {
  // ── State ──────────────────────────────────────────────────────────────
  const messages = ref([])
  const conversations = ref([])
  const activeConversationId = ref(null)
  const isStreaming = ref(false)
  const connectionStatus = ref('connected') // 'connected' | 'reconnecting' | 'offline'
  const baseUrl = ref('/api/v1')
  const error = ref(null)

  let connectionMonitor = null

  // ── Computed ───────────────────────────────────────────────────────────
  const isOnline = computed(() => connectionStatus.value !== 'offline')
  const canSend = computed(() => !isStreaming.value)

  // ── Actions ────────────────────────────────────────────────────────────

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

  // New conversation
  async function newConversation() {
    const id = await db.conversations.add({
      title: 'New Chat',
      lastMessage: '',
      updatedAt: Date.now()
    })
    activeConversationId.value = id
    messages.value = []
    await loadConversations()
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

  // Send a message
  async function sendMessage(content) {
    if (!content.trim() || isStreaming.value) return
    if (!activeConversationId.value) await newConversation()

    error.value = null

    // 1. Append user message instantly (optimistic)
    const userMsg = {
      conversationId: activeConversationId.value,
      role: 'user',
      content: content.trim(),
      status: 'sent',
      createdAt: Date.now()
    }
    const userId = await db.messages.add(userMsg)
    userMsg.id = userId
    messages.value.push(userMsg)

    // Update conversation metadata
    await db.conversations.update(activeConversationId.value, {
      lastMessage: content.trim(),
      updatedAt: Date.now()
    })

    // Auto-title from first user message
    const conv = await db.conversations.get(activeConversationId.value)
    if (conv && conv.title === 'New Chat') {
      const title = content.trim().slice(0, 40) + (content.trim().length > 40 ? '…' : '')
      await db.conversations.update(activeConversationId.value, { title })
    }

    // 2. Create placeholder assistant message
    const assistantMsg = {
      conversationId: activeConversationId.value,
      role: 'assistant',
      content: '',
      status: 'streaming',
      createdAt: Date.now()
    }
    const assistantId = await db.messages.add(assistantMsg)
    assistantMsg.id = assistantId
    messages.value.push(assistantMsg)
    const assistantIndex = messages.value.length - 1

    // 3. Build message list for API (exclude streaming placeholder from context)
    const contextMessages = messages.value
      .filter(m => m.id !== assistantId && m.status !== 'failed')
      .slice(-50) // last 50 messages for context window

    // 4. Stream response
    isStreaming.value = true
    connectionStatus.value = 'connected'

    let retries = 0
    const maxRetries = 3
    const retryDelay = 2000

    async function attemptStream() {
      try {
        await hermesClient.streamChat(contextMessages, {
          onToken(text) {
            messages.value[assistantIndex].content += text
          },
          onDone() {
            messages.value[assistantIndex].status = 'done'
            isStreaming.value = false
            connectionStatus.value = 'connected'
            // Persist completed message
            db.messages.update(assistantId, {
              content: messages.value[assistantIndex].content,
              status: 'done'
            })
            db.conversations.update(activeConversationId.value, {
              lastMessage: messages.value[assistantIndex].content.slice(0, 80),
              updatedAt: Date.now()
            })
          },
          onError(err) {
            if (retries < maxRetries) {
              retries++
              connectionStatus.value = 'reconnecting'
              setTimeout(attemptStream, retryDelay * retries)
            } else {
              messages.value[assistantIndex].status = 'failed'
              isStreaming.value = false
              connectionStatus.value = 'offline'
              error.value = 'Connection lost. Tap to retry.'
              db.messages.update(assistantId, { status: 'failed' })
            }
          }
        })
      } catch (err) {
        if (retries < maxRetries) {
          retries++
          connectionStatus.value = 'reconnecting'
          setTimeout(attemptStream, retryDelay * retries)
        } else {
          messages.value[assistantIndex].status = 'failed'
          isStreaming.value = false
          connectionStatus.value = 'offline'
          error.value = 'Connection lost. Tap to retry.'
          db.messages.update(assistantId, { status: 'failed' })
        }
      }
    }

    attemptStream()
  }

  // Retry a failed message
  async function retryMessage(messageId) {
    const msg = messages.value.find(m => m.id === messageId)
    if (!msg || msg.status !== 'failed') return

    // Remove the failed assistant message
    messages.value = messages.value.filter(m => m.id !== messageId)
    await db.messages.delete(messageId)

    // Find the last user message and resend
    const lastUserMsg = [...messages.value].reverse().find(m => m.role === 'user')
    if (lastUserMsg) {
      // Remove it so we don't duplicate
      messages.value = messages.value.filter(m => m.id !== lastUserMsg.id)
      await db.messages.delete(lastUserMsg.id)
      await sendMessage(lastUserMsg.content)
    }
  }

  // Stop streaming
  function stopStreaming() {
    hermesClient.abort()
    isStreaming.value = false
    // Mark current streaming message as done with partial content
    const streaming = messages.value.find(m => m.status === 'streaming')
    if (streaming) {
      streaming.status = 'done'
      db.messages.update(streaming.id, { status: 'done', content: streaming.content })
    }
  }

  // Set custom base URL
  async function setBaseUrl(url) {
    baseUrl.value = url
    hermesClient.setBaseUrl(url)
    await db.settings.put({ value: url }, 'baseUrl')
  }

  // Init: load state from DB
  async function init() {
    // Load saved base URL
    const savedUrl = await db.settings.get('baseUrl')
    if (savedUrl?.value) {
      baseUrl.value = savedUrl.value
      hermesClient.setBaseUrl(savedUrl.value)
    }

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
  }

  return {
    // state
    messages,
    conversations,
    activeConversationId,
    isStreaming,
    connectionStatus,
    baseUrl,
    error,
    // computed
    isOnline,
    canSend,
    // actions
    init,
    destroy,
    loadConversations,
    loadMessages,
    switchConversation,
    newConversation,
    deleteConversation,
    sendMessage,
    retryMessage,
    stopStreaming,
    setBaseUrl
  }
})
