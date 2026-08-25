// IndexedDB via Dexie — persists messages across reloads and offline.
//
// Tables:
//   agents        — the Hermes profiles you talk to (contacts). `name` is the
//                   profile id and maps directly to the gateway's /p/<name>/
//                   multiplex route.
//   messages      — chat rows; `agentName` tags which agent a message belongs
//                   to (profile id) for DM/group rendering and routing.
//   conversations — DM / group / default chats. A DM holds one agentIds entry,
//                   a group holds two+, a default holds none (routes to the
//                   gateway's default profile).
//   settings      — key/value (baseUrl, apiKey).
import Dexie from 'dexie'

const db = new Dexie('HermesChatDB')
db.version(1).stores({
  messages: '++id, conversationId, role, status, createdAt',
  conversations: '++id, title, lastMessage, updatedAt',
  settings: 'key'
})
// v2: add the agents (contacts) table. Dexie keeps unchanged stores as-is.
db.version(2).stores({
  agents: 'name, displayName, color, sort'
})

// Default agents seeded from the Hermes profiles on this host. Users can add /
// edit / remove contacts in Settings; the list is also editable for remote hosts.
const DEFAULT_AGENTS = [
  { name: 'developer', displayName: 'Developer', description: 'Coding & infrastructure agent', color: '#38bdf8', sort: 0 },
  { name: 'researcher', displayName: 'Researcher', description: 'Research & lead-gen agent', color: '#a78bfa', sort: 1 },
  { name: 'operations', displayName: 'Operations', description: 'Ops & pipeline agent', color: '#34d399', sort: 2 },
  { name: 'product-owner', displayName: 'Product Owner', description: 'Product & roadmap agent', color: '#fbbf24', sort: 3 },
  { name: 'quality-assurance', displayName: 'QA', description: 'Testing & review agent', color: '#fb7185', sort: 4 },
  { name: 'comedian', displayName: 'Comedian', description: 'Jokes & banter agent', color: '#f472b6', sort: 5 }
]

// Seed default agents on first run (idempotent). No default conversation is
// created — a new chat only appears in the list once its first message is sent.
db.on('ready', async () => {
  const agentCount = await db.agents.count()
  if (agentCount === 0) {
    await db.agents.bulkAdd(DEFAULT_AGENTS)
  }
})

export default db