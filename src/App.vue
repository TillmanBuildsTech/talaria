<template>
  <div class="flex flex-col h-dvh bg-slate-900 text-slate-100 overflow-hidden">
    <ConnectionBanner />

    <!-- Top bar -->
    <header class="flex items-center gap-2 px-4 py-3 border-b border-slate-800 shrink-0">
      <button
        @click="showSidebar = !showSidebar"
        class="p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
        aria-label="Conversations"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <div class="flex-1 min-w-0">
        <input
          v-if="editingTitle"
          v-model="titleDraft"
          ref="headerTitleInput"
          @keydown.enter.prevent="saveTitleEdit"
          @keydown.esc="editingTitle = false"
          @blur="saveTitleEdit"
          class="w-full bg-slate-900 text-sm font-semibold rounded px-1.5 py-0.5 outline-none ring-1 ring-blue-500 text-slate-100"
        />
        <button
          v-else
          class="w-full flex items-center gap-1.5 text-left group"
          :disabled="!store.activeConversationId"
          @click="startTitleEdit"
        >
          <span class="text-sm font-semibold truncate">{{ store.activeConvTitle }}</span>
          <svg
            v-if="store.activeConversationId"
            class="w-3.5 h-3.5 text-slate-500 opacity-0 group-hover:opacity-100 shrink-0 transition-opacity"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
      </div>
      <!-- Model picker + context (only once a conversation is open) -->
      <div v-if="store.activeConversationId" class="relative shrink-0">
        <button
          @click="showModelMenu = !showModelMenu"
          class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs transition-colors"
          :title="`Model for this conversation (${fmtTokens(store.activeContextWindow)} context)`"
        >
          <span class="w-1.5 h-1.5 rounded-full" :class="modelDotClass" />
          <span class="max-w-[150px] truncate text-slate-200 font-mono">{{ store.activeModelName || 'default' }}</span>
          <svg class="w-3 h-3 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <!-- Dropdown (backdrop closes on outside click) -->
        <div v-if="showModelMenu" class="fixed inset-0 z-30" @click="showModelMenu = false" />
        <div
          v-if="showModelMenu"
          class="absolute right-0 mt-2 w-80 z-40 bg-slate-800 rounded-xl border border-slate-700 shadow-xl overflow-hidden"
        >
          <div class="px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-700/60">Model for this conversation</div>
          <button
            @click="selectModel(null)"
            class="w-full text-left px-3 py-2 text-xs hover:bg-slate-700/60 transition-colors flex items-center justify-between gap-2"
          >
            <span class="text-slate-300">Profile default</span>
            <span v-if="!store.activeModelName" class="text-emerald-400">✓</span>
          </button>
          <div
            v-for="m in store.configuredModels"
            :key="m.model"
            @click="selectModel(m.model)"
            class="w-full text-left px-3 py-2 text-xs hover:bg-slate-700/60 transition-colors cursor-pointer flex flex-col gap-0.5"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="text-slate-200 font-mono truncate">{{ m.model }}</span>
              <span v-if="store.activeModelName === m.model" class="text-emerald-400 shrink-0">✓</span>
            </div>
            <div class="flex items-center gap-2 text-[10px] text-slate-500">
              <span v-if="m.provider" class="truncate">{{ m.provider }}</span>
              <span v-if="m.contextLength" class="shrink-0">{{ fmtTokens(m.contextLength) }} ctx</span>
            </div>
          </div>
          <div v-if="store.configuredModels.length === 0" class="px-3 py-2 text-xs text-slate-500">No models detected.</div>
        </div>
      </div>

      <button
        @click="showSettings = true"
        class="p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
        aria-label="Settings"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
    </header>

    <!-- Context-size indicator (bar turns amber → red as the chat fills the model window) -->
    <div
      v-if="store.activeConversationId && store.activeContextTokens > 0"
      class="px-4 py-1.5 flex items-center gap-2 border-b border-slate-800 bg-slate-900/70"
    >
      <span class="text-[10px] uppercase tracking-wider text-slate-500 shrink-0">context</span>
      <div class="flex-1 h-1 rounded-full bg-slate-800 overflow-hidden">
        <div class="h-full rounded-full transition-all duration-300" :class="contextBarClass" :style="{ width: contextWidth }" />
      </div>
      <span class="text-[10px] font-mono text-slate-400 shrink-0">
        {{ fmtTokens(store.activeContextTokens) }} / {{ fmtTokens(store.activeContextWindow) }}
      </span>
    </div>

    <!-- Chat area -->
    <div ref="chatContainer" class="flex-1 overflow-y-auto px-4 py-3 space-y-4">
      <!-- Empty state -->
      <div v-if="store.messages.length === 0" class="flex flex-col items-center justify-center h-full text-slate-500 gap-3">
        <svg class="w-12 h-12 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
            d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
        <p class="text-sm">Send a message to start chatting. Open the sidebar to message an agent directly or start a group.</p>
      </div>

      <ChatMessage
        v-for="msg in store.messages"
        :key="msg.id"
        :message="msg"
        @retry="store.retryMessage(msg.id)"
      />

      <!-- Auto-scroll anchor -->
      <div ref="scrollAnchor" />
    </div>

    <!-- Input -->
    <ChatInput @send="handleSend" @stop="store.stopStreaming()" />

    <!-- Sidebar overlay -->
    <Transition name="slide">
      <Sidebar v-if="showSidebar" @close="showSidebar = false" />
    </Transition>

    <!-- Settings modal -->
    <SettingsModal v-if="showSettings" @close="showSettings = false" />
  </div>
</template>

<script setup>
import { ref, watch, computed, onMounted, nextTick } from 'vue'
import { useChatStore } from './stores/chat.js'
import ConnectionBanner from './components/ConnectionBanner.vue'
import ChatMessage from './components/ChatMessage.vue'
import ChatInput from './components/ChatInput.vue'
import Sidebar from './components/Sidebar.vue'
import SettingsModal from './components/SettingsModal.vue'

const store = useChatStore()
const showSidebar = ref(false)
const showSettings = ref(false)
const chatContainer = ref(null)
const scrollAnchor = ref(null)
const editingTitle = ref(false)
const titleDraft = ref('')
const headerTitleInput = ref(null)
const showModelMenu = ref(false)

// ── Context-size / model indicator helpers ──────────────────────────────
function fmtTokens(n) {
  if (n == null) return '—'
  if (n >= 1000) return (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k'
  return String(n)
}
function contextLevel() {
  const w = store.activeContextWindow || 1
  const r = store.activeContextTokens / w
  if (r >= 0.85) return 'red'
  if (r >= 0.6) return 'amber'
  return 'green'
}
const contextBarClass = computed(() => ({
  red: 'bg-red-500', amber: 'bg-amber-500', green: 'bg-emerald-500'
}[contextLevel()]))
const modelDotClass = computed(() => ({
  red: 'bg-red-400', amber: 'bg-amber-400', green: 'bg-emerald-400'
}[contextLevel()]))
const contextWidth = computed(() =>
  Math.min(100, (store.activeContextTokens / (store.activeContextWindow || 1)) * 100) + '%'
)
function selectModel(modelName) {
  store.setConversationModel(modelName)
  showModelMenu.value = false
}

function startTitleEdit() {
  if (!store.activeConversationId) return
  titleDraft.value = store.activeConvTitle
  editingTitle.value = true
  nextTick(() => {
    const el = headerTitleInput.value
    if (el && el.focus) { el.focus(); el.select && el.select() }
  })
}

function saveTitleEdit() {
  if (editingTitle.value && store.activeConversationId) {
    store.renameConversation(store.activeConversationId, titleDraft.value)
  }
  editingTitle.value = false
}

// Auto-scroll to bottom on new messages
function scrollToBottom() {
  nextTick(() => {
    scrollAnchor.value?.scrollIntoView({ behavior: 'smooth' })
  })
}

watch(() => store.messages.length, scrollToBottom)
watch(() => {
  const msgs = store.messages
  return msgs.length > 0 ? msgs[msgs.length - 1].content : ''
}, scrollToBottom)

function handleSend(text) {
  store.sendMessage(text)
}

onMounted(async () => {
  await store.init()
  await nextTick()
  scrollToBottom()
})
</script>

<style>
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.25s ease;
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(-100%);
}
</style>
