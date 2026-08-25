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
        <!-- API Key (optional for local gateway) -->
        <div>
          <label class="block text-xs font-medium text-slate-400 mb-1.5">API Key</label>
          <input
            v-model="keyInput"
            type="password"
            @keydown.enter="saveAll"
            class="w-full bg-slate-800 text-sm rounded-lg px-3 py-2.5 border-none outline-none
                   focus:ring-2 focus:ring-blue-500/50 text-slate-100 placeholder-slate-600"
            placeholder="Required for gateway authentication"
          />
          <p class="text-xs text-slate-600 mt-1">
            Hermes Gateway API Server key
          </p>
        </div>

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
          @click="saveAll"
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

        <!-- Agents (profile contacts) -->
        <div class="pt-1">
          <div class="flex items-center justify-between mb-1.5">
            <p class="text-xs font-medium text-slate-500">Agents (Hermes profiles)</p>
            <button
              @click="beginAdd"
              class="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >{{ editingAgent || addingAgent ? 'Cancel' : '+ Add' }}</button>
          </div>

          <!-- Add / edit agent form -->
          <div v-if="addingAgent" class="space-y-2 mb-2 bg-slate-800/50 rounded-lg p-3">
            <input
              v-model="formName"
              :disabled="!!editingAgent"
              placeholder="Profile name (e.g. developer)"
              class="w-full bg-slate-800 text-sm rounded-lg px-3 py-2 border-none outline-none
                     focus:ring-2 focus:ring-blue-500/50 text-slate-100 placeholder-slate-600 disabled:opacity-50"
            />
            <input
              v-model="formDisplay"
              placeholder="Display name (optional)"
              class="w-full bg-slate-800 text-sm rounded-lg px-3 py-2 border-none outline-none
                     focus:ring-2 focus:ring-blue-500/50 text-slate-100 placeholder-slate-600"
            />
            <input
              v-model="formApiKey"
              type="password"
              placeholder="API key (auto-filled from global if empty)"
              class="w-full bg-slate-800 text-sm rounded-lg px-3 py-2 border-none outline-none
                     focus:ring-2 focus:ring-blue-500/50 text-slate-100 placeholder-slate-600"
            />
            <button
              @click="saveAgent"
              :disabled="!formName.trim()"
              class="w-full py-2 rounded-lg text-sm font-medium transition-colors"
              :class="formName.trim()
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'"
            >{{ editingAgent ? 'Save agent' : 'Add agent' }}</button>
            <p class="text-[11px] text-slate-600">
              Each Hermes profile has its own API key. Requires
              <code class="text-slate-500">gateway.multiplex_profiles</code> on the gateway.
            </p>
          </div>

          <ul class="divide-y divide-slate-800/60">
            <li v-for="agent in store.agents" :key="agent.name" class="flex items-center gap-3 py-2">
              <AgentAvatar :name="agent.name" :display="agent.displayName" :color="agent.color" :size="9" />
              <span class="flex-1 min-w-0">
                <span class="block text-sm text-slate-200 truncate">{{ agent.displayName }}</span>
                <span class="block text-xs text-slate-500 font-mono truncate">{{ agent.name }}</span>
              </span>
              <button
                @click="beginEdit(agent)"
                class="text-xs text-slate-400 hover:text-slate-200 transition-colors shrink-0"
              >Edit</button>
              <button
                @click="store.removeAgent(agent.name)"
                class="text-xs text-red-400 hover:text-red-300 transition-colors shrink-0"
              >Remove</button>
            </li>
          </ul>
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
import AgentAvatar from './AgentAvatar.vue'

const store = useChatStore()
const emit = defineEmits(['close'])

const urlInput = ref(store.baseUrl)
const keyInput = ref(store.apiKey)
const addingAgent = ref(false)
const editingAgent = ref(null)
const formName = ref('')
const formDisplay = ref('')
const formApiKey = ref('')

const presets = [
  { label: 'Local (Vite proxy)', url: '/api/v1', short: '/api/v1' },
  { label: 'Local direct', url: 'http://localhost:8642/api/v1', short: ':8642' },
  { label: 'Cloudflare Tunnel', url: 'https://hermes.yourdomain.com/api/v1', short: 'CF' },
  { label: 'Tailscale', url: 'http://100.x.x.x:8642/api/v1', short: 'TS' },
]

function saveAll() {
  store.setBaseUrl(urlInput.value)
  store.setApiKey(keyInput.value)
  emit('close')
}

function beginAdd() {
  editingAgent.value = null
  formName.value = ''
  formDisplay.value = ''
  formApiKey.value = ''
  addingAgent.value = !addingAgent.value
}

function beginEdit(agent) {
  editingAgent.value = agent
  formName.value = agent.name
  formDisplay.value = agent.displayName || ''
  formApiKey.value = agent.apiKey || ''
  addingAgent.value = true
}

async function saveAgent() {
  const name = formName.value.trim()
  if (!name) return
  await store.addAgent({
    name,
    displayName: formDisplay.value.trim(),
    apiKey: formApiKey.value.trim()
  })
  editingAgent.value = null
  formName.value = ''
  formDisplay.value = ''
  formApiKey.value = ''
  addingAgent.value = false
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
