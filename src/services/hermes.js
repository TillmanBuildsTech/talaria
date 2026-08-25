// Hermes API client — SSE streaming with exponential-backoff reconnect
//
// The Hermes gateway API Server runs on port 8642 and exposes an
// OpenAI-compatible /v1/chat/completions endpoint. We stream SSE chunks
// via fetch + ReadableStream (custom headers + auto-retry).
//
// Multi-agent routing: when `gateway.multiplex_profiles` is on, one gateway
// serves every Hermes profile. Each profile (an "agent" / contact in the app)
// is reached by URL prefix:
//
//   POST /v1/chat/completions            → default profile
//   POST /p/<profile>/v1/chat/completions → named profile
//
// Auth: multiplex scopes API_SERVER_KEY per profile, so each agent has its own
// bearer key. The client accepts a per-request `apiKey` override; when absent
// it falls back to the global key (used for the default profile / legacy chat).
//
// Connection modes:
//   local  — dev proxy via Vite (localhost:8642)
//   remote — Cloudflare Tunnel, Tailscale, or SSH tunnel URL
//   custom — user-provided base URL set in settings

const DEFAULT_BASE = '/api/v1'

class HermesClient {
  constructor(baseUrl = DEFAULT_BASE) {
    this.baseUrl = baseUrl
    this.apiKey = null
    // Track every in-flight AbortController so group-chat fan-out (multiple
    // concurrent streams) can be stopped all at once.
    this.activeControllers = new Set()
  }

  setBaseUrl(url) {
    this.baseUrl = url
  }

  setApiKey(key) {
    this.apiKey = key
  }

  // ---------------------------------------------------------------------------
  // Health check — verifies the gateway is reachable
  // ---------------------------------------------------------------------------
  async healthCheck() {
    try {
      const r = await fetch(`${this.baseUrl.replace(/\/api\/v1\/?$/, '')}/`, {
        signal: AbortSignal.timeout(5000)
      })
      return r.ok
    } catch {
      return false
    }
  }

  // ---------------------------------------------------------------------------
  // Streaming chat completion via fetch + ReadableStream
  //
  // opts.agent  — Hermes profile name. When set, the request is routed to that
  //               profile's multiplex URL (POST /p/<name>/chat/completions).
  //               Omit (undefined/null) to use the gateway's default profile.
  // opts.apiKey — per-request Authorization override. When omitted, falls back
  //               to the global this.apiKey. Needed because multiplex scopes
  //               API_SERVER_KEY per profile — each agent has its own key.
  // ---------------------------------------------------------------------------
  async streamChat(messages, callbacks, opts = {}) {
    const { onToken, onDone, onError } = callbacks
    const { agent, apiKey } = opts

    const controller = new AbortController()
    this.activeControllers.add(controller)

    // Insert the /p/<agent>/ prefix between the base and the chat route:
    //   /api/v1/p/researcher/v1/chat/completions
    // (dev proxy strips /api, leaving /p/researcher/v1/chat/completions)
    const prefix = agent ? `/p/${encodeURIComponent(agent)}` : ''
    const url = `${this.baseUrl}${prefix}/chat/completions`

    const payload = {
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: true
    }

    // Ensure the controller is cleared on every exit path.
    const release = () => this.activeControllers.delete(controller)

    try {
      const headers = { 'Content-Type': 'application/json' }
      const key = apiKey !== undefined ? apiKey : this.apiKey
      if (key) {
        headers['Authorization'] = `Bearer ${key}`
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text().catch(() => 'unknown')}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        // Keep the last partial line in the buffer
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data:')) continue

          const data = trimmed.slice(5).trim()
          if (data === '[DONE]') {
            release()
            onDone && onDone()
            return
          }

          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta
            if (delta?.content) {
              onToken(delta.content)
            }
          } catch {
            // skip unparseable chunks
          }
        }
      }
      release()
      onDone && onDone()
    } catch (err) {
      release()
      if (err.name === 'AbortError') return
      onError && onError(err)
    }
  }

  // Abort every in-flight stream (group fan-out safety).
  abort() {
    for (const c of this.activeControllers) {
      c.abort()
    }
    this.activeControllers.clear()
  }
}

export const hermesClient = new HermesClient()

// ---------------------------------------------------------------------------
// Connection monitor — fires events when online/offline
// ---------------------------------------------------------------------------
export function createConnectionMonitor(callbacks) {
  const { onOnline, onOffline } = callbacks

  const goOnline = () => onOnline && onOnline()
  const goOffline = () => onOffline && onOffline()

  window.addEventListener('online', goOnline)
  window.addEventListener('offline', goOffline)

  // Also periodically health-check the Hermes endpoint
  let healthInterval = null

  function startHealthChecks(intervalMs = 15000) {
    stopHealthChecks()
    healthInterval = setInterval(async () => {
      const healthy = await hermesClient.healthCheck()
      if (healthy && !navigator.onLine) {
        // Browser thinks offline but endpoint reachable — treat as online
        goOnline()
      }
    }, intervalMs)
  }

  function stopHealthChecks() {
    if (healthInterval) {
      clearInterval(healthInterval)
      healthInterval = null
    }
  }

  return {
    destroy() {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      stopHealthChecks()
    },
    startHealthChecks,
    stopHealthChecks
  }
}