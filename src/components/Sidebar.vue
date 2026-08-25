<template>
  <div class="fixed inset-0 z-30 flex">
    <!-- Backdrop -->
    <div class="absolute inset-0 bg-black/50" @click="$emit('close')" />

    <!-- Sidebar panel -->
    <div class="relative w-80 max-w-[85vw] h-full bg-slate-950 border-r border-slate-800 flex flex-col shadow-xl">
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-slate-800 shrink-0">
        <h2 class="text-sm font-semibold flex items-center gap-2">
          {{ picking ? (picking === 'group' ? 'New group chat' : 'Direct message') : 'Chat' }}
        </h2>
        <div class="flex items-center gap-1">
          <button
            v-if="picking"
            @click="picking = null"
            class="p-1.5 rounded-lg hover:bg-slate-800 transition-colors text-slate-400"
            aria-label="Back"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
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
      </div>

      <!-- Agent picker (DM / group) -->
      <div v-if="picking" class="flex-1 overflow-y-auto py-1">
        <p class="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {{ picking === 'group' ? 'Select agents' : 'Choose an agent' }}
        </p>
        <button
          v-for="agent in store.agents"
          :key="agent.name"
          @click="toggleAgent(agent)"
          class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-800/50 transition-colors"
        >
          <!-- Checkbox (group) / radio dot (DM) -->
          <span
            v-if="picking === 'group'"
            class="w-5 h-5 shrink-0 rounded border flex items-center justify-center text-xs"
            :class="selected.includes(agent.name) ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-600 text-transparent'"
          >✓</span>
          <span
            v-else
            class="w-5 h-5 shrink-0 rounded-full border-2"
            :class="selected.includes(agent.name) ? 'border-blue-500' : 'border-slate-600'"
          />
          <Avatar :name="agent.name" :display="agent.displayName" :color="agent.color" :size="10" />
          <span class="flex-1 min-w-0">
            <span class="block text-sm font-medium text-slate-200 truncate">{{ agent.displayName }}</span>
            <span class="block text-xs text-slate-500 truncate">{{ agent.description || agent.name }}</span>
          </span>
        </button>

        <div v-if="picking === 'group'" class="px-4 py-3">
          <button
            @click="startGroup"
            :disabled="selected.length < 2"
            class="w-full py-2.5 rounded-lg text-sm font-medium transition-colors"
            :class="selected.length >= 2
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed'"
          >
            {{ selected.length >= 2 ? `Start group (${selected.length})` : 'Select at least 2 agents' }}
          </button>
        </div>
      </div>

      <!-- Main view -->
      <template v-else>
        <!-- Agents (contacts) for instant DM -->
        <div class="border-b border-slate-800">
          <div class="flex items-center justify-between px-4 pt-3 pb-1">
            <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Agents</p>
            <button
              @click="picking = 'dm'"
              class="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >New DM</button>
          </div>
          <div class="px-2 pb-2 flex flex-wrap gap-1.5">
            <button
              v-for="agent in store.agents"
              :key="agent.name"
              @click="direct(agent.name)"
              class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs transition-colors"
              :style="{ backgroundColor: agent.color + '22', color: agent.color }"
              :title="`Message ${agent.displayName}`"
            >
              <span class="w-2 h-2 rounded-full" :style="{ backgroundColor: agent.color }" />
              {{ agent.displayName }}
            </button>
          </div>
          <button
            @click="picking = 'group'"
            class="w-full text-left px-4 py-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-colors"
          >
            ＋ New group chat
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
            <div class="flex items-center gap-2">
              <ConversationBadge :conv="conv" :store="store" />
              <span class="text-sm font-medium truncate text-slate-200 flex-1">{{ title(conv) }}</span>
            </div>
            <div class="text-xs text-slate-500 truncate mt-0.5 pl-10">
              {{ conv.lastMessage || 'No messages yet' }}
            </div>
          </button>

          <div v-if="store.conversations.length === 0" class="px-4 py-8 text-center text-slate-600 text-sm">
            No conversations yet
          </div>
        </div>
      </template>

      <!-- Footer -->
      <div class="px-4 py-3 border-t border-slate-800 text-xs text-slate-600">
        Hermes Chat — tap an agent to message it directly
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useChatStore } from '../stores/chat.js'
import Avatar from './AgentAvatar.vue'
import ConversationBadge from './ConversationBadge.vue'

const store = useChatStore()
const emit = defineEmits(['close'])

const picking = ref(null) // null | 'dm' | 'group'
const selected = ref([])

function toggleAgent(agent) {
  if (picking.value === 'dm') {
    selected.value = [agent.name]
    direct(agent.name)
    return
  }
  const i = selected.value.indexOf(agent.name)
  if (i >= 0) selected.value.splice(i, 1)
  else selected.value.push(agent.name)
}

function direct(name) {
  store.newDirectMessage(name)
  selected.value = []
  picking.value = null
  emit('close')
}

function startGroup() {
  if (selected.value.length < 2) return
  store.newGroupConversation(selected.value)
  selected.value = []
  picking.value = null
  emit('close')
}

function title(conv) {
  return store.convTitle(conv)
}

function select(id) {
  store.switchConversation(id)
  emit('close')
}
</script>