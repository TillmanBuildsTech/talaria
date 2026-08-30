# Talaria — Design & Architecture

## Overview

Talaria is a zero-friction PWA chat client for [Hermes Agent](https://github.com/NousResearch/hermes-agent). It connects to a remote Hermes Gateway's API Server over Cloudflare Tunnels, Tailscale, SSH tunnels, or direct LAN, providing an installable native-feeling mobile chat experience.

**Core thesis:** Existing Hermes clients require desktop installs or Docker. A PWA gives instant mobile access — tap "Add to Home Screen" and you're chatting with your agent. No app store, no sideload, no native build.

**Multi-agent:** Each of your Hermes *profiles* surfaces as an **Agent** (a contact) in the app. You can DM any agent directly, or put several agents in a **group chat** and @-mention them. Routing is built on the Hermes gateway's native profile multiplexing — see [Multi-Agent Chat](#multi-agent-chat--agents--contacts).

---

## Stack Rationale

| Choice | Why | Rejected alternatives |
|---|---|---|
| **Vue 3 + Composition API** | Granular reactivity updates only the text node being streamed into — no virtual DOM diffing the entire chat tree on every SSE token. Single File Components keep structure dead simple. | React: virtual DOM overhead on high-frequency streaming. Svelte: smaller ecosystem, fewer PWA plugins. |
| **Vite** | Sub-second HMR, native ESM, best PWA plugin ecosystem. | Webpack/CRA: slower builds, heavier config. |
| **Pinia** | Official Vue 3 store, tree-shakeable, devtools support. Simpler API than Vuex. | Vuex: legacy, heavier. Zustand: React-first. |
| **Dexie.js** | Promise-based IndexedDB wrapper. Handles schema migrations, compound queries, bulk ops. | localForage: simpler but no querying. Raw IndexedDB: verbose callback API. |
| **Tailwind CSS v4** | Utility-first, tiny production bundle (tree-shakes unused classes). Dark theme is free. | Component libraries: too heavy for PWA, slow TTI. |
| **Raw fetch + ReadableStream** | Zero-dependency SSE parsing. Reads `data:` chunks from the response body stream. | `EventSource` (browser): no custom headers, no POST. `fetch-event-source` (Microsoft): extra 3KB dep for functionality we can write in 40 lines. |
| **vite-plugin-pwa** | Workbox integration, auto-update, precaching, manifest generation — all from Vite config. | `workbox-build` directly: more manual setup, less Vite integration. |

---

## Component Tree

```
App.vue
├── ConnectionBanner.vue        ← Reactive banner: offline → amber, reconnecting → blue
├── <header>                    ← Hamburger, conversation title, settings gear
├── <chat-area>
│   ├── ChatMessage.vue (×N)    ← User (blue, right), assistant (slate, left)
│   │                              Streaming: animated cursor pulse
│   │                              Failed: red border + "Tap to retry"
│   └── <scroll-anchor>         ← Auto-scroll target
├── ChatInput.vue               ← Auto-growing textarea, send/stop/clear buttons
├── Sidebar.vue (overlay)       ← Conversation list, new chat, active indicator
└── SettingsModal.vue (modal)   ← API URL, quick-connect presets, data wipe
```

### Component contracts

| Component | Props | Emits | Owns |
|---|---|---|---|
| `ChatMessage` | `message: {id, role, content, status}` | `retry` | Bubble styling, streaming cursor, error UI |
| `ChatInput` | (none — reads store) | `send(text)`, `stop` | Text state, auto-resize, keyboard submit |
| `ConnectionBanner` | (none — reads store) | (none) | Banner visibility, icon + color by status |
| `Sidebar` | (none — reads store) | `close` | Backdrop click-to-close, slide transition |
| `SettingsModal` | (none — reads store) | `close` | URL input, preset buttons, clear confirmation |

Components read from the Pinia store directly rather than prop-drilling. This keeps the component tree flat — no wrapper components just to pass data down.

---

## Data Flow

```
User types → ChatInput emits 'send'
  → store.sendMessage(text)
    → Optimistic: user message appended to state + IndexedDB
    → Placeholder assistant message appended (status: 'streaming')
    → hermesClient.streamChat(contextMessages, callbacks)
      → fetch POST /api/v1/chat/completions (SSE)
      → onToken: append content to assistant message (Vue reactivity updates DOM)
      → onDone: mark status='done', persist to IndexedDB
      → onError: retry up to 3× with exponential backoff
        → Exhausted: mark status='failed', show "Tap to retry"
```

### Why optimistic UI

Mobile connections are spotty. If the user sends a message and stares at a spinner for 3 seconds, they think the app is broken. Optimistic append means the UI always responds instantly. If the stream fails, the failed state is visually distinct (red bubble) and retryable.

### Why placeholder assistant message

The assistant bubble appears immediately (empty, with pulse cursor) so the layout doesn't jump when the first token arrives. This prevents the chat area from snapping-scrolling on stream start.

---

## Streaming (SSE) Implementation

```
src/services/hermes.js
```

### Design decisions

1. **Raw `fetch` + `ReadableStream` over `EventSource`**: The Hermes API uses POST with a JSON body. Browser `EventSource` only supports GET with query params — can't send the message history. We parse `data:` lines manually from the stream.

2. **Buffer handling**: `TextDecoder` with `{ stream: true }` handles partial UTF-8 sequences across chunk boundaries. We split on `\n` and keep the last partial line in the buffer.

3. **`data: [DONE]` detection**: OpenAI-compatible stream termination. When received, call `onDone` and return.

4. **Skip unparseable chunks**: JSON parse errors are silently skipped. Corrupted chunks on spotty connections shouldn't crash the stream.

5. **AbortController**: Stored on the client instance. `stopStreaming()` calls `abort()`, which rejects the fetch with `AbortError` — we catch and return silently.

### Why not WebSockets

The Hermes API Server exposes REST + SSE, not WebSockets. SSE over HTTP is also simpler for mobile — reconnects are just retrying the POST, no WebSocket upgrade handshake to renegotiate through tunnels.

---

## Connection Resilience

Three layers of protection:

### Layer 1: Browser online/offline events
`ConnectionBanner` reacts to `window.addEventListener('online'/'offline')`. Instant feedback — the banner slides in the moment the OS drops the connection.

### Layer 2: Endpoint health checks
A 15-second interval pings the Hermes Gateway root endpoint. This catches cases where the browser thinks it's online (Wi-Fi connected) but the tunnel to Hermes is down.

### Layer 3: Stream retry
On stream failure, the store retries up to 3 times with exponential backoff:
- Attempt 1: immediate
- Attempt 2: 2s delay
- Attempt 3: 4s delay
- Exhausted: mark failed, show retry button

The retry re-executes the full POST — Hermes is stateless (each request is independent), so resuming mid-stream isn't possible. This is acceptable for a chat app.

---

## Multi-Agent Chat (Agents / Contacts)

Every Hermes profile you run can be reached from the app as an **Agent** — a contact you DM directly, or group with others and @-mention. This rides on the Hermes gateway's native **profile multiplexing**: one gateway on one port serves *every* profile, addressed by URL prefix.

### Backend prerequisite (required once)

The gateway API Server must have profile multiplexing enabled:

```yaml
# in the gateway's config.yaml (the profile that owns the api_server gateway)
gateway:
  multiplex_profiles: true
```

then `hermes gateway restart`. With it on, `profiles_to_serve(multiplex=True)` serves the default profile plus every valid directory under `profiles/`. Without it, `/p/<profile>/` routes 404 (except the self-referential default), so DMs to non-default profiles fail closed.

### Routing contract

| Chat | HTTP route | Notes |
|---|---|---|
| Default / legacy conversation | `POST /api/v1/chat/completions` | gateway's default profile |
| DM to `researcher` | `POST /api/v1/p/researcher/v1/chat/completions` | multiplex prefix |
| Group member | interpolated `/p/<member>/…` per target | fan-out for `@all` |

**Auth:** every profile shares the base URL, but multiplex **scopes `API_SERVER_KEY` per profile** — each agent authenticates with *its own* key (verified: default key on `/p/researcher/` → 401; researcher's own key → 200). The app lets you store a key per agent in Settings; an agent with no stored key falls back to the global key (the default profile's).

### Data model

**`agents`** (new table, keyed by `name` = profile id)
| Field | Type | Notes |
|---|---|---|
| `name` | PK | profile id → `/p/<name>/` |
| `displayName` | str | friendly label |
| `color` | str | avatar accent hex |
| `description` | str | one-liner |
| `apiKey` | str | optional per-profile API key |
| `sort` | int | ordering |

Seeded from the profiles on this host (developer, researcher, operations, product-owner, quality-assurance, comedian); editable in Settings.

**`conversations`** — added `kind` (`default`/`dm`/`group`) and `agentIds` (`[]` default, `[name]` DM, `[name, …]` group).

**`messages`** — added `agentName` (which agent a message belongs to: author badge on assistant replies) and `targetAgents` (who a user @'d).

### @-mention routing (`resolveTargets`)

For a **group** conversation, an outgoing message is routed to:
- **every member explicitly @mentioned** — `@Developer @QA` (multiple targets fan out concurrently)
- **all members** on `@all`
- **the primary (first) member** when unaddressed (keeps group traffic lean / cost-conscious)

DMs resolve to their single agent; `default` conversations resolve to the gateway default (no prefix). Context for each reply is built from the *stored* conversation (placeholders + failed rows excluded, last 50), so concurrent fan-out replies are independent and don't cross-contaminate.

### Concurrency

`streamChat` tags each in-flight stream with its own `AbortController` (tracked in a Set) so group fan-out streams run in parallel and `stopStreaming()` aborts them all. `isStreaming` is a computed over `activeStreams` rather than a boolean.

### UI

- **Sidebar**: an **Agents** chip row (tap = instant DM), **New DM** and **New group chat** pickers, conversation list with agent badges.
- **ChatMessage**: author/target badge above replies and @-targeted user messages.
- **ChatInput**: tappable @-mention chips while in a group; dynamic placeholder.
- **Settings**: add/remove agents (profile ids).

### Known constraints

- `@all`/multi-target fan-out calls each profile once per message (N × tokens) — by design, gated behind an explicit `@all`, no silent default fan-out.
- Group chat is local state (like all conversations); Hermes itself has no multi-party memory of the "room" — each turn is an independent request carrying its own context.

---

## State Management (Pinia Store)

```
src/stores/chat.js
```

### State shape

```js
{
  messages: [],              // Current conversation messages (reactive)
  conversations: [],         // All conversations (sidebar list)
  activeConversationId: null,// Which conversation is open
  isStreaming: false,        // Prevents sending while streaming
  connectionStatus: string,  // 'connected' | 'reconnecting' | 'offline'
  baseUrl: '/api/v1',        // Hermes API base URL (persisted)
  error: null                // Last error message
}
```

### Key computed properties

- `isOnline`: `connectionStatus !== 'offline'` — drives banner visibility
- `canSend`: `!isStreaming` — disables input during streaming

### Actions

| Action | Side effects |
|---|---|
| `sendMessage(text)` | Optimistic append → stream → persist |
| `retryMessage(id)` | Remove failed message + last user message, re-send |
| `stopStreaming()` | Abort fetch, mark streaming message as done |
| `setBaseUrl(url)` | Update client + persist to IndexedDB |
| `switchConversation(id)` | Load messages for that conversation from DB |
| `newConversation()` | Create in DB, switch to it |
| `deleteConversation(id)` | Delete messages + conversation from DB |

### Why Pinia over composables

Composables are great for encapsulating logic, but they don't share state across components without prop-drilling or provide/inject. Pinia gives us a single source of truth that any component can read from without knowing about the component tree.

---

## Persistence (IndexedDB Schema)

```
src/db.js
```

### Tables

**`messages`**
| Field | Type | Index | Notes |
|---|---|---|---|
| `id` | auto | PK | |
| `conversationId` | number | indexed | Foreign key to conversations |
| `role` | string | | 'user' or 'assistant' |
| `content` | string | | Full message text |
| `status` | string | | 'sent', 'streaming', 'done', 'failed' |
| `createdAt` | number | | `Date.now()` |

**`conversations`**
| Field | Type | Index | Notes |
|---|---|---|---|
| `id` | auto | PK | |
| `title` | string | | Auto-set from first message |
| `lastMessage` | string | | Truncated preview for sidebar |
| `updatedAt` | number | indexed | Sort order for sidebar |

**`settings`**
| Field | Type | Index | Notes |
|---|---|---|---|
| `key` | string | PK | e.g. 'baseUrl' |
| `value` | any | | Stored value |

**`agents`** (added in v2)
| Field | Type | Index | Notes |
|---|---|---|---|
| `name` | string | PK | Hermes profile id → `/p/<name>/` |
| `displayName` | string | | Friendly label |
| `color` | string | | Avatar accent hex |
| `description` | string | | One-liner |
| `apiKey` | string | | Optional per-profile API key |
| `sort` | number | | Ordering |

`conversations` additionally carries `kind` ('default' | 'dm' | 'group') and
`agentIds` (array of profile names); `messages` carries `agentName` and
`targetAgents`. Seed data: one default conversation + the bundled agents.

### Write pattern

1. Write to IndexedDB immediately (durable)
2. Update Pinia state (reactive, drives UI)
3. Don't wait for DB writes — they're async and non-blocking

### Read pattern

- `init()`: load conversations + messages on app start
- `switchConversation()`: load messages for the selected conversation
- Messages filtered to last 50 for API context window

---

## PWA Configuration

```
vite.config.js (VitePWA plugin)
```

### Manifest

- `display: standalone` — no browser chrome when installed
- `orientation: portrait` — locked for mobile chat UX
- `theme_color / background_color: #0f172a` — slate-900, matches app shell, no white flash on launch

### Service Worker (Workbox)

- **`registerType: autoUpdate`**: When a new build deploys, the SW updates in the background. Next page load gets the new version. No "New version available" prompt needed — chat state is in IndexedDB, not the DOM.
- **Precaching**: 14 assets (HTML, CSS, JS, icons) cached at install time. App loads from cache instantly — no network round-trip for the shell.
- **Runtime caching**: `/api/v1/*` requests use `NetworkOnly` — never served from cache. Chat data must be fresh.

### Why no Background Sync

The Background Sync API requires the PWA to be installed AND the browser to support it (Chromium only). We handle offline retry in the application layer instead — more portable, no API dependency.

---

## Connection Modes

The app supports four connection presets:

| Mode | URL pattern | Use case |
|---|---|---|
| Local (Vite proxy) | `/api/v1` | Development — Vite proxies to `localhost:8642` |
| Local direct | `http://localhost:8642/api/v1` | Production on same machine |
| Cloudflare Tunnel | `https://hermes.yourdomain.com/api/v1` | Remote access via CF Tunnel with TLS |
| Tailscale | `http://100.x.x.x:8642/api/v1` | Remote access via Tailscale mesh VPN |

The base URL is persisted to IndexedDB and restored on next launch.

---

## Styling Approach

### Tailwind v4 + CSS-first

No component library. The app has 5 components — a library would add more weight than it saves. Tailwind utilities are tree-shaken at build: the production CSS is 18.98KB (4.62KB gzipped).

### Dark theme only

The app is always dark (`slate-900` background, `slate-800` surfaces, `slate-100` text). Hermes desktop has a dark aesthetic — the PWA matches it. No theme toggle means less code, less state, no flash-of-light-theme on load.

### Mobile-first

- `h-dvh` instead of `h-screen` — respects mobile browser address bar collapse
- `overscroll-none` on body — prevents pull-to-refresh from losing chat scroll position
- `viewport-fit=cover` — extends into the notch/safe area on modern phones
- `max-w-[85%]` on message bubbles — prevents edge-to-edge text on wide tablets

---

## Known Limitations & Future Work

### Current limitations

1. **No message editing/deletion**: Messages are append-only. Deletion would need tombstoning in the API context window.
2. **No image/file attachments**: The Hermes API supports multimodal but we're text-only.
3. **No model selection**: Always uses the gateway's default model. Model picker would need a `/models` endpoint.
4. **No streaming resume**: If the stream drops at token 500 of 1000, we restart the entire request. Hermes has no checkpoint/continue API.
5. **Single session only**: No Hermes `/new` concept. Each conversation is local. To start fresh with Hermes context, the user must reset on the Hermes side separately.

### Extension points

| Feature | Where to add |
|---|---|
| Model picker | `SettingsModal.vue` — dropdown, persist to `settings` table |
| Image upload | `ChatInput.vue` — camera/gallery button, base64 encode, add to message |
| Markdown rendering | `ChatMessage.vue` — run content through `marked` + `highlight.js` |
| Copy message | `ChatMessage.vue` — long-press handler, `navigator.clipboard.writeText()` |
| Voice input | `ChatInput.vue` — `MediaRecorder` API, send to Hermes STT endpoint |
| Multi-account | New `accounts` Dexie table + account switcher in settings |
| Message search | FTS on `messages.content` via Dexie `orderBy` filter |

---

## File Map

```
talaria/
├── index.html                    ← Entry point, meta tags, PWA apple-mobile-web-app
├── vite.config.js                ← Vue + Tailwind + PWA plugins, dev proxy
├── package.json                  ← Dependencies (7 total, no framework bloat)
├── DESIGN.md                     ← This file
├── public/
│   ├── favicon.ico / .svg
│   ├── apple-touch-icon.png
│   ├── pwa-192x192.png
│   └── pwa-512x512.png
└── src/
    ├── main.js                   ← App bootstrap, Pinia install
    ├── App.vue                   ← Shell layout, sidebar/settings overlay
    ├── style.css                 ← Tailwind import only
    ├── db.js                     ← Dexie schema + seed (agents, conversations, messages)
    ├── services/
    │   └── hermes.js             ← SSE client (/p/<agent>/ routing), health check, connection monitor
    ├── stores/
    │   └── chat.js               ← Pinia store — chat + agents state, @-mention routing
    └── components/
        ├── AgentAvatar.vue       ← Colored initial-circle avatar for an agent
        ├── ConversationBadge.vue ← Sidebar badge (dot for DM, dot cluster for group)
        ├── ChatMessage.vue       ← Message bubble with author badge + status variants
        ├── ChatInput.vue         ← Auto-grow textarea, @mention chips, send/stop/clear
        ├── ConnectionBanner.vue  ← Offline/reconnecting status strip
        ├── Sidebar.vue           ← Contacts (Agents), DM/group pickers, conversation list
        └── SettingsModal.vue     ← API config + agent (profile) management, data wipe
```

---

## Build & Deploy

```bash
npm install
npm run build        # → dist/ (static files, no server needed)
npm run preview      # Local preview of production build
```

**Deploy anywhere that serves static files:**
- GitHub Pages, Cloudflare Pages, Netlify, Vercel
- Nginx/Caddy on the Hermes host
- S3 + CloudFront
- Serve from the Hermes Gateway itself (add a static file route)

**To connect through Cloudflare Tunnel:** deploy the static build, configure the API URL in Settings to point at your tunneled Hermes instance, and the PWA communicates directly from the browser — no server-side proxy needed.
