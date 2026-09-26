// IndexedDB via Dexie — persists messages, agents, conversations, settings and goals.
import Dexie from 'dexie'

const db = new Dexie('HermesChatDB')

// v1: messages, conversations, settings
db.version(1).stores({
  messages: '++id, conversationId, role, status, createdAt',
  conversations: '++id, title, lastMessage, updatedAt',
  settings: 'key',
})

// v2: agents
db.version(2).stores({
  agents: 'name, displayName, color, sort',
})

// v3: goals (new for P0 Kanban/CEO mode)
db.version(3).stores({
  goals: '++id, title, board, kanbanTaskId, createdAt',
})

export default db
