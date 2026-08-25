<template>
  <div class="px-3 py-3 border-t border-slate-800 shrink-0 bg-slate-900">
    <!-- Group mention helper -->
    <div
      v-if="store.activeGroupMembers.length > 1"
      class="flex items-center gap-1.5 mb-2 overflow-x-auto pb-0.5"
    >
      <span class="text-[11px] uppercase tracking-wider text-slate-500 shrink-0">@</span>
      <button
        v-for="name in store.activeGroupMembers"
        :key="name"
        @click="insertMention(name)"
        class="flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-colors shrink-0 border border-slate-700"
        :style="{ backgroundColor: store.agentColor(name) + '1a', color: store.agentColor(name) }"
        :title="`Mention ${store.agentDisplay(name)}`"
      >
        <span class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: store.agentColor(name) }" />
        {{ store.agentDisplay(name) }}
      </button>
      <button
        @click="insertMention(null)"
        class="px-2 py-1 rounded-full text-xs transition-colors shrink-0 border border-slate-700 text-slate-300 hover:bg-slate-800"
        title="Mention all agents"
      >@all</button>
    </div>

    <div class="flex items-end gap-2">
      <!-- Text area (auto-grows) -->
      <div class="flex-1 relative">
        <!-- Slash command suggestions -->
        <div
          v-if="showSlashPanel"
          class="absolute bottom-full left-0 mb-2 w-72 max-h-56 overflow-y-auto bg-slate-800 rounded-xl border border-slate-700 shadow-xl z-20 py-1"
        >
          <div class="px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-700/60">Commands</div>
          <button
            v-for="c in filteredCommands"
            :key="c.cmd"
            @click="applyCommand(c)"
            class="w-full text-left flex items-start justify-between gap-2 px-3 py-2 text-xs hover:bg-slate-700/60 transition-colors"
          >
            <span class="text-blue-300 font-mono shrink-0">{{ c.cmd }}</span>
            <span class="text-slate-400 text-right leading-tight">{{ c.desc }}</span>
          </button>
          <div v-if="filteredCommands.length === 0" class="px-3 py-2 text-xs text-slate-500">No matching commands</div>
        </div>
        <textarea
          ref="inputEl"
          v-model="text"
          @keydown.enter.exact.prevent="submit"
          @input="resize"
          rows="1"
          class="w-full bg-slate-800 text-sm rounded-xl px-4 py-2.5 pr-10 resize-none
                 border-none outline-none focus:ring-2 focus:ring-blue-500/50
                 placeholder-slate-500 text-slate-100 max-h-32"
          :disabled="store.isStreaming"
          :placeholder="placeholder"
        />
        <!-- Clear button -->
        <button
          v-if="text && !store.isStreaming"
          @click="text = ''"
          class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-300"
          aria-label="Clear input"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Stop button (while streaming) -->
      <button
        v-if="store.isStreaming"
        @click="$emit('stop')"
        class="shrink-0 w-10 h-10 flex items-center justify-center
               bg-red-600 hover:bg-red-700 rounded-full transition-colors"
        aria-label="Stop generating"
      >
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      </button>

      <!-- Send button -->
      <button
        v-else
        @click="submit"
        :disabled="!text.trim()"
        class="shrink-0 w-10 h-10 flex items-center justify-center
               rounded-full transition-all"
        :class="text.trim()
          ? 'bg-blue-600 hover:bg-blue-700 text-white'
          : 'bg-slate-800 text-slate-600 cursor-not-allowed'"
        aria-label="Send"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useChatStore } from '../stores/chat.js'

const store = useChatStore()
const emit = defineEmits(['send', 'stop'])
const text = ref('')
const inputEl = ref(null)

const placeholder = computed(() => {
  const members = store.activeGroupMembers
  if (members.length > 1) return 'Message the group (@agent to direct)…'
  if (members.length === 1) return `Message ${store.agentDisplay(members[0])}…`
  return 'Message Hermes…'
})

// Slash-command suggestion popover.
const showSlashPanel = computed(() =>
  text.value.trim().startsWith('/') && !store.isStreaming
)
const filteredCommands = computed(() => {
  const idx = text.value.indexOf(' ')
  const prefix = (idx === -1 ? text.value : text.value.slice(0, idx)).trim().toLowerCase()
  return store.COMMANDS.filter(c => c.cmd.toLowerCase().startsWith(prefix))
})
function applyCommand(c) {
  // Commands with args insert just the base token so the user can fill in.
  const base = c.cmd.split(' ')[0]
  text.value = base + ' '
  resize()
  nextTickFocus()
}

function submit() {
  const trimmed = text.value.trim()
  if (!trimmed || store.isStreaming) return
  emit('send', trimmed)
  text.value = ''
  resize()
}

// Insert an @mention token at the caret (or append). null → @all
function insertMention(name) {
  const token = name ? `@${name} ` : '@all '
  const el = inputEl.value
  const start = el ? el.selectionStart || text.value.length : text.value.length
  text.value = text.value.slice(0, start) + token + text.value.slice(start)
  resize()
  nextTickFocus()
}

function nextTickFocus() {
  requestAnimationFrame(() => {
    const el = inputEl.value
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  })
}

function resize() {
  const el = inputEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 128) + 'px'
}

onMounted(() => {
  inputEl.value?.focus()
})
</script>