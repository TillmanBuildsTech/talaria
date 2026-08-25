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

      <!-- Elapsed + token count (assistant replies) -->
      <div
        v-if="!message.system && message.role === 'assistant' && (elapsedText || tokensText)"
        class="mt-1.5 pt-1.5 border-t border-slate-700/40 text-[10px] text-slate-500 flex items-center gap-2"
      >
        <span v-if="elapsedText">{{ elapsedText }}</span>
        <span v-if="tokensText">{{ tokensText }}</span>
        <span
          v-if="message.status === 'streaming'"
          class="inline-flex items-center gap-1 text-slate-600"
        >
          <span class="w-1 h-1 rounded-full bg-slate-500 animate-pulse" />
          streaming
        </span>
      </div>

      <!-- Failed state -->
      <div
        v-if="!message.system && message.status === 'failed'"
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
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useChatStore } from '../stores/chat.js'

const props = defineProps({
  message: { type: Object, required: true }
})

defineEmits(['retry'])

const store = useChatStore()

// Live clock used to show elapsed time while a reply is streaming.
const now = ref(Date.now())
let timer = null

function startTimer() {
  stopTimer()
  if (props.message.status === 'streaming') {
    timer = setInterval(() => { now.value = Date.now() }, 500)
  }
}
function stopTimer() {
  if (timer) { clearInterval(timer); timer = null }
}

watch(() => props.message.status, startTimer)
onMounted(startTimer)
onBeforeUnmount(stopTimer)

function fmt(ms) {
  if (ms == null) return null
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}

const elapsedText = computed(() => {
  const m = props.message
  if (m.elapsedMs != null) return fmt(m.elapsedMs)
  if (m.status === 'streaming' && m.startedAt) return fmt(now.value - m.startedAt)
  return null
})

const tokensText = computed(() => {
  const t = props.message.tokens
  return t != null ? `${t.toLocaleString()} tok` : null
})

// Badge above a message:
//  - user message that @'d specific agents → "@Developer" chips
//  - assistant reply in a DM/group → author agent name
const badge = computed(() => {
  const m = props.message
  if (m.system) return null
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
  if (props.message.system) {
    return 'bg-slate-900 text-slate-400 italic border border-slate-800 rounded-bl-md text-xs'
  }
  return 'bg-slate-800 text-slate-100 rounded-bl-md'
})
</script>