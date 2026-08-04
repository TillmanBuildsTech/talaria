<template>
  <div v-if="banner" class="shrink-0">
    <div
      class="flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium text-center transition-colors"
      :class="bannerClass"
    >
      <svg v-if="store.connectionStatus === 'offline'" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M18.364 5.636a9 9 0 010 12.728m-2.829-2.829a5 5 0 000-7.07m-7.072 7.072a5 5 0 010-7.07m9.9 12.728a11.99 11.99 0 01-12.728 0" />
      </svg>
      <svg v-else class="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      {{ banner }}
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useChatStore } from '../stores/chat.js'

const store = useChatStore()

const banner = computed(() => {
  switch (store.connectionStatus) {
    case 'offline': return 'Offline — waiting for connection…'
    case 'reconnecting': return 'Reconnecting…'
    default: return null
  }
})

const bannerClass = computed(() => {
  switch (store.connectionStatus) {
    case 'offline': return 'bg-amber-600/90 text-amber-50'
    case 'reconnecting': return 'bg-blue-600/90 text-blue-50'
    default: return ''
  }
})
</script>
