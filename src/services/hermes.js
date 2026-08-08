// Hermes API client — SSE streaming with exponential-backoff reconnect
//
// The Hermes gateway API Server runs on port 8642 and exposes an
// OpenAI-compatible /v1/chat/completions endpoint. We stream SSE chunks
// via fetch-event-source's PostEventSource (custom headers + auto-retry).
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
    this.abortController = null
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
  // Uses raw fetch with a ReadableStream reader — much lighter than pulling in
  // fetch-event-source as a dependency. Handles reconnection externally.
  // ---------------------------------------------------------------------------
  async streamChat(messages, callbacks) {
    const { onToken, onDone, onError } = callbacks
    this.abortController = new AbortController()

    const payload = {
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: true
    }

    try {
      const headers = { 'Content-Type': 'application/json' }
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`
      }
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: this.abortController.signal
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
      onDone && onDone()
    } catch (err) {
      if (err.name === 'AbortError') return
      onError && onError(err)
    }
  }

  abort() {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
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
