<template>
  <div class="px-3 py-3 border-t border-slate-800 shrink-0 bg-slate-900">
    <div class="flex items-end gap-2">
      <!-- Text area (auto-grows) -->
      <div class="flex-1 relative">
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
          placeholder="Message Hermes..."
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
import { ref, onMounted } from 'vue'
import { useChatStore } from '../stores/chat.js'

const store = useChatStore()
const emit = defineEmits(['send', 'stop'])
const text = ref('')
const inputEl = ref(null)

function submit() {
  const trimmed = text.value.trim()
  if (!trimmed || store.isStreaming) return
  emit('send', trimmed)
  text.value = ''
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
