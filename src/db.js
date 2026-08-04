// IndexedDB via Dexie — persists messages across reloads and offline
import Dexie from 'dexie'

const db = new Dexie('HermesChatDB')
db.version(1).stores({
  messages: '++id, conversationId, role, status, createdAt',
  conversations: '++id, title, lastMessage, updatedAt',
  settings: 'key'
})

// Seed default conversation if empty
db.on('ready', async () => {
  const count = await db.conversations.count()
  if (count === 0) {
    await db.conversations.add({
      title: 'New Chat',
      lastMessage: '',
      updatedAt: Date.now()
    })
  }
})

export default db
