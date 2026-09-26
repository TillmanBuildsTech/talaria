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

      <!-- Tabs -->
      <div class="flex gap-1 px-5 pt-3 text-xs font-medium text-slate-500">
        <button
          v-for="t in tabs"
          :key="t.id"
          @click="activeTab = t.id"
          class="px-3 py-2 rounded-t-lg transition-colors"
          :class="activeTab === t.id ? 'bg-slate-800 text-slate-200' : 'hover:text-slate-300'"
        >{{ t.label }}</button>
      </div>

      <div class="px-5 py-4 space-y-5">
        <!-- Connection tab -->
        <div v-if="activeTab === 'connection'">
          <label class="block text-xs font-medium text-slate-400 mb-1.5">API Key</label>
          <input v-model="keyInput" type="password"
            class="w-full bg-slate-800 text-sm rounded-lg px-3 py-2.5 border-none outline-none focus:ring-2 focus:ring-blue-500/50 text-slate-100"
            placeholder="Required for gateway authentication" />

          <label class="block text-xs font-medium text-slate-400 mb-1.5 mt-3">Hermes API URL</label>
          <input v-model="urlInput" @keydown.enter="saveAll"
            class="w-full bg-slate-800 text-sm rounded-lg px-3 py-2.5 border-none outline-none focus:ring-2 focus:ring-blue-500/50 text-slate-100"
            placeholder="http://localhost:8642/api/v1" />

          <button @click="saveAll" class="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-sm font-medium transition-colors mt-4">
            Save &amp; Reconnect
          </button>
        </div>

        <!-- Goals tab -->
        <div v-if="activeTab === 'goals'">
          <!-- New goal form -->
          <form @submit.prevent="submitGoal" class="space-y-3 bg-slate-800/40 rounded-lg p-4">
            <div>
              <label class="block text-xs font-medium text-slate-400 mb-1.5">Goal Title</label>
              <input v-model="goalTitle" required
                class="w-full bg-slate-800 text-sm rounded-lg px-3 py-2 border-none outline-none focus:ring-2 focus:ring-blue-500/50 text-slate-100"
                placeholder="e.g., deploy kanban sync to dev" />
            </div>

            <div>
              <label class="block text-xs font-medium text-slate-400 mb-1.5">Acceptance Criteria</label>
              <textarea v-model="goalAC" required rows="3"
                class="w-full bg-slate-800 text-sm rounded-lg px-3 py-2 border-none outline-none focus:ring-2 focus:ring-blue-500/50 text-slate-100"
                placeholder="- Task moves to triage&#10;- Assignee set to developer&#10;- Build passes" />
              <p class="text-xs text-slate-600 mt-1">One criterion per line (bullet list)</p>
            </div>

            <div>
              <label class="block text-xs font-medium text-slate-400 mb-1.5">Board</label>
              <select v-model="goalBoard"
                class="w-full bg-slate-800 text-sm rounded-lg px-3 py-2 border-none outline-none focus:ring-2 focus:ring-blue-500/50 text-slate-100">
                <option value="triage">Triage</option>
                <option value="ready">Ready</option>
                <option value="in-progress">In Progress</option>
              </select>
            </div>

            <button type="submit"
              class="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-sm font-medium transition-colors">
              Create Goal
            </button>
          </form>

          <!-- Existing goals list -->
          <ul v-if="goals.length" class="divide-y divide-slate-800/60 mt-3">
            <li v-for="g in goals" :key="g.id" class="py-2 flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="text-sm text-slate-200 truncate">{{ g.title }}</p>
                <p class="text-xs text-slate-500">{{ g.board }} &middot; task {{ g.kanbanTaskId }}</p>
              </div>
              <button @click="deleteGoal(g.id)" class="text-xs text-red-400 hover:text-red-300 shrink-0">Remove</button>
            </li>
          </ul>

          <p v-else class="text-xs text-slate-600 mt-2">No goals yet. Create one above.</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useGoalsStore } from '../stores/goals.js'
import db from '../db.js'

const emit = defineEmits(['close'])
const store = useGoalsStore()

const tabs = [
  { id: 'connection', label: 'Connection' },
  { id: 'goals', label: 'Goals' },
]
const activeTab = ref('connection')

const urlInput = ref('')
const keyInput = ref('')

// Goal form state
const goalTitle = ref('')
const goalAC = ref('')
const goalBoard = ref('triage')

onMounted(() => {
  store.loadGoals()
})

const goals = store.goals

async function submitGoal() {
  await store.createGoalLocal(goalTitle.value, goalAC.value, goalBoard.value)
  goalTitle.value = ''
  goalAC.value = ''
  goalBoard.value = 'triage'
}

async function deleteGoal(id) {
  await store.removeGoal(id)
}

async function saveAll() {
  emit('close')
}
</script>