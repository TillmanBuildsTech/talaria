<template>
  <div class="fixed inset-0 z-30 flex">
    <!-- Backdrop -->
    <div class="absolute inset-0 bg-black/50" @click="$emit('close')" />

    <!-- Sidebar panel -->
    <div class="relative w-72 max-w-[85vw] h-full bg-slate-950 border-r border-slate-800 flex flex-col shadow-xl">
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <h2 class="text-sm font-semibold">Conversations</h2>
        <button
          @click="store.newConversation()"
          class="p-1.5 rounded-lg hover:bg-slate-800 transition-colors text-blue-400"
          aria-label="New chat"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      <!-- Conversation list -->
      <div class="flex-1 overflow-y-auto py-1">
        <button
          v-for="conv in store.conversations"
          :key="conv.id"
          @click="select(conv.id)"
          class="w-full text-left px-4 py-3 hover:bg-slate-800/50 transition-colors border-l-2"
          :class="conv.id === store.activeConversationId
            ? 'border-blue-500 bg-slate-800/70'
            : 'border-transparent'"
        >
          <div class="text-sm font-medium truncate text-slate-200">{{ conv.title }}</div>
          <div class="text-xs text-slate-500 truncate mt-0.5">
            {{ conv.lastMessage || 'No messages yet' }}
          </div>
        </button>

        <div v-if="store.conversations.length === 0" class="px-4 py-8 text-center text-slate-600 text-sm">
          No conversations yet
        </div>
      </div>

      <!-- Footer -->
      <div class="px-4 py-3 border-t border-slate-800 text-xs text-slate-600">
        Hermes Chat v1.0
      </div>
    </div>
  </div>
</template>

<script setup>
import { useChatStore } from '../stores/chat.js'

const store = useChatStore()
const emit = defineEmits(['close'])

function select(id) {
  store.switchConversation(id)
  emit('close')
}
</script>
