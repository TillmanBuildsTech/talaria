// Pinia store for managing goal definitions and their references to kanban tasks.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import db from '../db.js'
import { createGoal } from '../services/kanban.js'

export const useGoalsStore = defineStore('goals', () => {
  const goals = ref([])
  const loading = ref(false)
  const error = ref(null)

  // Load all goals from IndexedDB
  async function loadGoals() {
    try {
      loading.value = true
      error.value = null
      goals.value = await db.goals.toArray()
    } catch (e) {
      error.value = e.message
      console.error('Failed to load goals:', e)
    } finally {
      loading.value = false
    }
  }

  // Create a new goal and link it to a kanban task
  async function createGoalLocal(title, acceptanceCriteria, board = 'triage') {
    try {
      error.value = null
      // Build the body for the kanban create call
      const body = {
        title: title,
        body: acceptanceCriteria,
        assignee: 'developer', // Default to developer; can be overridden in UI
        triage: true // Mark as triage for board routing
      }

      // Call the kanban service to create the actual task
      const taskId = await createGoal(body)

      // Save the goal to IndexedDB with the kanban task reference
      const goal = {
        id: crypto.randomUUID(),
        title: title,
        acceptanceCriteria: acceptanceCriteria,
        board: board,
        kanbanTaskId: taskId,
        createdAt: new Date().toISOString()
      }

      await db.goals.add(goal)
      await loadGoals() // Refresh the list
      return goal
    } catch (e) {
      error.value = e.message
      console.error('Failed to create goal:', e)
      throw e
    }
  }

  // Remove a goal from IndexedDB (doesn't delete the kanban task)
  async function removeGoal(id) {
    try {
      error.value = null
      await db.goals.delete(id)
      await loadGoals()
    } catch (e) {
      error.value = e.message
      console.error('Failed to remove goal:', e)
    }
  }

  // Computed: group goals by board
  const goalsByBoard = computed(() => {
    const grouped = {}
    goals.value.forEach(goal => {
      if (!grouped[goal.board]) grouped[goal.board] = []
      grouped[goal.board].push(goal)
    })
    return grouped
  })

  return {
    goals,
    loading,
    error,
    goalsByBoard,
    loadGoals,
    createGoalLocal,
    removeGoal
  }
})