<template>
  <div class="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
    <!-- Backdrop -->
    <div class="absolute inset-0 bg-black/60" @click="$emit('close')" />

    <!-- Modal -->
    <div class="relative w-full max-w-md bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-800 shadow-2xl max-h-[85vh] overflow-y-auto">
      <div class="sticky top-0 bg-slate-900 px-5 py-4 border-b border-slate-800 flex items-center justify-between">
        <h2 class="text-base font-semibold">Settings</h2>
        <button @click="$emit('close')" class="p-1 rounded-lg hover:bg-slate-800 transition-colors">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="px-5 py-4 space-y-5">
        <!-- Connection URL -->
        <div>
          <label class="block text-xs font-medium text-slate-400 mb-1.5">Hermes API URL</label>
          <input
            v-model="urlInput"
            @keydown.enter="saveUrl"
            class="w-full bg-slate-800 text-sm rounded-lg px-3 py-2.5 border-none outline-none
                   focus:ring-2 focus:ring-blue-500/50 text-slate-100 placeholder-slate-600"
            placeholder="http://localhost:8642/api/v1"
          />
          <p class="text-xs text-slate-600 mt-1">
            Use <code class="text-slate-500">/api/v1</code> for local dev, or full URL for remote
          </p>
        </div>

        <button
          @click="saveUrl"
          class="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-sm font-medium transition-colors"
        >
          Save &amp; Reconnect
        </button>

        <!-- Presets -->
        <div class="space-y-1.5">
          <p class="text-xs font-medium text-slate-500">Quick connect</p>
          <button
            v-for="preset in presets"
            :key="preset.label"
            @click="urlInput = preset.url"
            class="w-full text-left px-3 py-2 rounded-lg text-sm text-slate-400
                   hover:bg-slate-800 hover:text-slate-200 transition-colors
                   flex items-center justify-between"
          >
            <span>{{ preset.label }}</span>
            <span class="text-xs text-slate-600 font-mono">{{ preset.short }}</span>
          </button>
        </div>

        <!-- Danger zone -->
        <div class="pt-3 border-t border-slate-800">
          <button
            @click="clearAll"
            class="w-full py-2.5 rounded-lg border border-red-500/30 text-red-400
                   text-sm font-medium hover:bg-red-500/10 transition-colors"
          >
            Clear All Data
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useChatStore } from '../stores/chat.js'
import db from '../db.js'

const store = useChatStore()
const emit = defineEmits(['close'])

const urlInput = ref(store.baseUrl)

const presets = [
  { label: 'Local (Vite proxy)', url: '/api/v1', short: '/api/v1' },
  { label: 'Local direct', url: 'http://localhost:8642/api/v1', short: ':8642' },
  { label: 'Cloudflare Tunnel', url: 'https://hermes.yourdomain.com/api/v1', short: 'CF' },
  { label: 'Tailscale', url: 'http://100.x.x.x:8642/api/v1', short: 'TS' },
]

function saveUrl() {
  store.setBaseUrl(urlInput.value)
  emit('close')
}

async function clearAll() {
  if (!confirm('Delete all conversations and messages? This cannot be undone.')) return
  await db.messages.clear()
  await db.conversations.clear()
  store.messages = []
  store.conversations = []
  store.activeConversationId = null
  emit('close')
}
</script>
