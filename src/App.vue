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
      <h1 class="text-sm font-semibold flex-1 truncate">
        {{ store.activeConvTitle }}
      </h1>
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
import { ref, watch, onMounted, nextTick } from 'vue'
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
