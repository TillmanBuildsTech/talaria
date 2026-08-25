<template>
  <div class="flex flex-col" :class="message.role === 'user' ? 'items-end' : 'items-start'">
    <!-- Target/author badge: for user @mentions and for assistant replies -->
    <div
      v-if="badge"
      class="flex items-center gap-1 text-[11px] mb-1 px-1"
      :style="{ color: badgeColor }"
    >
      <span v-for="(b, i) in badge" :key="i" :style="{ color: badgeColorFor(b) }">
        {{ b.startsWith('@') ? b : b + ' ·' }}
      </span>
    </div>

    <div
      class="max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words"
      :class="bubbleClass"
    >
      <!-- Content -->
      <span>{{ message.content }}</span>

      <!-- Streaming cursor -->
      <span
        v-if="message.status === 'streaming'"
        class="inline-block w-2 h-4 ml-0.5 bg-blue-400 animate-pulse align-text-bottom rounded-sm"
      />

      <!-- Failed state -->
      <div
        v-if="message.status === 'failed'"
        class="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-red-500/30"
      >
        <svg class="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        <button
          @click="$emit('retry')"
          class="text-xs text-red-400 hover:text-red-300 underline transition-colors"
        >
          Tap to retry
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useChatStore } from '../stores/chat.js'

const props = defineProps({
  message: { type: Object, required: true }
})

defineEmits(['retry'])

const store = useChatStore()

// Badge above a message:
//  - user message that @'d specific agents → "@Developer" chips
//  - assistant reply in a DM/group → author agent name
const badge = computed(() => {
  const m = props.message
  if (m.role === 'user') {
    const t = m.targetAgents || []
    if (t.length && t.length < 4) return t.map(n => '@' + store.agentDisplay(n))
    return null
  }
  if (m.agentName) return [store.agentDisplay(m.agentName)]
  return null
})

const badgeColor = computed(() => {
  const m = props.message
  const name = m.agentName
  return name ? store.agentColor(name) : null
})

function badgeColorFor(b) {
  const name = b.replace(/^@/, '')
  const agent = store.agents.find(a => a.displayName === name || a.name === name)
  return agent ? store.agentColor(agent.name) : '#94a3b8'
}

const bubbleClass = computed(() => {
  if (props.message.role === 'user') {
    return 'bg-blue-600 text-white rounded-br-md'
  }
  if (props.message.status === 'failed') {
    return 'bg-red-900/40 text-red-200 border border-red-500/30 rounded-bl-md'
  }
  return 'bg-slate-800 text-slate-100 rounded-bl-md'
})
</script>