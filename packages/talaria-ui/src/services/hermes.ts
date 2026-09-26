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

const DEFAULT_BASE = "/api/v1";

export type StreamMessage = { role: string; content: string };

export type StreamUsage = {
  total_tokens?: number;
  completion_tokens?: number;
  prompt_tokens?: number;
};

export type StreamCallbacks = {
  onToken: (text: string) => void;
  onDone?: () => void | Promise<void>;
  onError?: (err: unknown) => void | Promise<void>;
  onSessionId?: (id: string) => void;
  onUsage?: (usage: StreamUsage) => void;
};

export type StreamOptions = {
  agent?: string | null;
  apiKey?: string | null;
  sessionId?: string;
  model?: string;
  provider?: string;
  // Stall watchdog: a stream that yields no chunk for this long is treated
  // as dead (abort → onError → the caller's retry ladder) instead of hanging
  // the bubble on "streaming" forever. LLMs pause, but never this long.
  stallTimeoutMs?: number;
};

export type SessionRecord = {
  id: string;
  role: string;
  content: string;
  timestamp?: number;
};

export type SessionSummary = {
  id: string;
  title?: string;
  preview?: string;
  last_active?: number;
  message_count?: number;
};

class HermesClient {
  baseUrl: string;
  apiKey: string | null;
  // Track every in-flight AbortController so group-chat fan-out (multiple
  // concurrent streams) can be stopped all at once.
  activeControllers: Set<AbortController>;
  // Stall-watchdog timers (one per in-flight stream) so abort() can clear
  // them instead of leaking a 45s timer per cancelled stream.
  stallTimers: Set<ReturnType<typeof setTimeout>>;

  constructor(baseUrl: string = DEFAULT_BASE) {
    this.baseUrl = baseUrl;
    this.apiKey = null;
    this.activeControllers = new Set();
    this.stallTimers = new Set();
  }

  setBaseUrl(url: string) {
    this.baseUrl = url;
  }

  setApiKey(key: string) {
    this.apiKey = key;
  }

  // Gateway origin/root derived from baseUrl. Strips a trailing "/api/v1" so
  // both API families (/v1/* chat and /api/* sessions) are addressed off one
  // root:  "/api/v1" -> ""   "http://host:8642/api/v1" -> "http://host:8642"
  gatewayRoot(): string {
    return this.baseUrl.replace(/\/api\/v1\/?$/, "");
  }

  // Route path for an agent (profile) — multiplex prefix /p/<name>/.
  agentPrefix(agent?: string | null): string {
    return agent ? `/p/${encodeURIComponent(agent)}` : "";
  }

  chatUrl(agent?: string | null): string {
    return `${this.gatewayRoot()}${this.agentPrefix(agent)}/v1/chat/completions`;
  }

  createSessionUrl(agent?: string | null): string {
    return `${this.gatewayRoot()}${this.agentPrefix(agent)}/api/sessions`;
  }

  sessionMessagesUrl(agent: string | null | undefined, sessionId: string): string {
    return `${this.gatewayRoot()}${this.agentPrefix(agent)}/api/sessions/${encodeURIComponent(sessionId)}/messages?order=oldest`;
  }

  // ---------------------------------------------------------------------------
  // Health check — verifies the gateway is reachable
  // ---------------------------------------------------------------------------
  async healthCheck(): Promise<boolean> {
    try {
      const r = await fetch(`${this.gatewayRoot()}/`, {
        signal: AbortSignal.timeout(5000),
      });
      return r.ok;
    } catch {
      return false;
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
  async streamChat(messages: Array<StreamMessage>, callbacks: StreamCallbacks, opts: StreamOptions = {}) {
    const { onToken, onDone, onError, onSessionId, onUsage } = callbacks;
    const { agent, apiKey, sessionId, model, provider } = opts;

    const controller = new AbortController();
    this.activeControllers.add(controller);

    // Same-origin gateway path: /v1/chat/completions or /p/<agent>/v1/...
    const url = this.chatUrl(agent);

    const payload: Record<string, unknown> = {
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    };
    // Model/provider override: when supplied, the gateway uses these instead of
    // the profile's configured default (honored for explicit provider values).
    if (model) payload.model = model;
    if (provider) payload.provider = provider;

    // Ensure the controller is cleared on every exit path.
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    let stalled = false;
    const release = () => {
      this.activeControllers.delete(controller);
      if (stallTimer) {
        clearTimeout(stallTimer);
        this.stallTimers.delete(stallTimer);
        stallTimer = null;
      }
    };
    // Stall watchdog: no chunk for `stallTimeoutMs` → kill the stream so the
    // caller retries instead of hanging on "streaming" forever.
    const pokeStall = () => {
      if (stallTimer) {
        clearTimeout(stallTimer);
        this.stallTimers.delete(stallTimer);
      }
      stallTimer = setTimeout(() => {
        stalled = true;
        controller.abort();
      }, opts.stallTimeoutMs ?? 45_000);
      this.stallTimers.add(stallTimer);
    };

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const key = apiKey !== undefined ? apiKey : this.apiKey;
      if (key) {
        headers.Authorization = `Bearer ${key}`;
      }
      // Server-side session continuity: the gateway persists this turn to state.db
      // so every device reading the same session id sees the full history.
      if (sessionId) {
        headers["X-Hermes-Session-Id"] = sessionId;
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text().catch(() => "unknown")}`);
      }

      // Echo back the effective session id so the client can persist it.
      if (onSessionId) {
        const echo = response.headers.get("X-Hermes-Session-Id");
        if (echo) onSessionId(echo);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        release();
        onDone?.();
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";
      pokeStall();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        pokeStall();

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the last partial line in the buffer
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;

          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") {
            release();
            await onDone?.();
            return;
          }

          try {
            const parsed = JSON.parse(data);
            if (onUsage && parsed.usage) onUsage(parsed.usage);
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) {
              onToken(delta.content);
            }
          } catch {
            // skip unparseable chunks
          }
        }
      }
      release();
      await onDone?.();
    } catch (err) {
      release();
      if (err instanceof Error && err.name === "AbortError") {
        // A stall-abort is a dead stream, not a user cancel — route it into
        // the retry ladder like any other transport failure.
        if (stalled) await onError?.(new Error("stream stalled: no data from gateway"));
        return;
      }
      await onError?.(err);
    }
  }

  // Abort every in-flight stream (group fan-out safety).
  abort() {
    for (const c of this.activeControllers) {
      c.abort();
    }
    this.activeControllers.clear();
    for (const t of this.stallTimers) {
      clearTimeout(t);
    }
    this.stallTimers.clear();
  }

  // ---------------------------------------------------------------------------
  // Server-side session persistence (cross-device history sync)
  // ---------------------------------------------------------------------------
  // Explicitly create a Hermes session row. Returns { id } or throws.
  async createSession(agent: string | null | undefined, { apiKey }: { apiKey?: string | null } = {}) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const key = apiKey !== undefined ? apiKey : this.apiKey;
    if (key) headers.Authorization = `Bearer ${key}`;
    const r = await fetch(this.createSessionUrl(agent), {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    if (!r.ok) throw new Error(`createSession HTTP ${r.status}`);
    const data = await r.json();
    const sessionObj = data.session || data;
    return { id: sessionObj && (sessionObj.id || sessionObj.session_id) };
  }

  // Fetch a session's persisted messages (oldest-first). Returns an array of
  // { id, role, content, timestamp } records, or [] when the session is empty.
  async fetchSessionMessages(
    agent: string | null | undefined,
    sessionId: string,
    { apiKey }: { apiKey?: string | null } = {}
  ): Promise<Array<SessionRecord>> {
    const headers: Record<string, string> = {};
    const key = apiKey !== undefined ? apiKey : this.apiKey;
    if (key) headers.Authorization = `Bearer ${key}`;
    const r = await fetch(this.sessionMessagesUrl(agent, sessionId), { headers });
    if (!r.ok) {
      // 404 = session not created yet — treat as empty.
      if (r.status === 404) return [];
      throw new Error(`fetchSessionMessages HTTP ${r.status}`);
    }
    const data = await r.json();
    return data?.data || [];
  }

  // List a profile's persisted sessions (used to rediscover conversations on a
  // fresh device). Returns an array of { id, title, preview, last_active, ... }.
  async listSessions(
    agent: string | null | undefined,
    { apiKey }: { apiKey?: string | null } = {},
    limit = 200
  ): Promise<Array<SessionSummary>> {
    const headers: Record<string, string> = {};
    const key = apiKey !== undefined ? apiKey : this.apiKey;
    if (key) headers.Authorization = `Bearer ${key}`;
    const r = await fetch(`${this.gatewayRoot()}${this.agentPrefix(agent)}/api/sessions?limit=${limit}`, {
      headers,
    });
    if (!r.ok) return [];
    const data = await r.json();
    return data?.data || [];
  }
}

export const hermesClient = new HermesClient();

// ---------------------------------------------------------------------------
// Connection monitor — fires events when online/offline
// ---------------------------------------------------------------------------
export type ConnectionMonitorCallbacks = {
  onOnline?: () => void;
  onReconnecting?: () => void;
  onOffline?: () => void;
};

// Connection monitor — fires events when online/offline. The browser
// online/offline events only reflect the device's network, NOT whether the
// Hermes gateway is reachable, so the periodic health check drives the real
// presence: first failed check → reconnecting, `unhealthyThreshold`
// consecutive failures → offline, any success → online (recovering from a
// transient outage as soon as the gateway answers again).
export function createConnectionMonitor(
  callbacks: ConnectionMonitorCallbacks,
  opts: { intervalMs?: number; unhealthyThreshold?: number } = {}
) {
  const { onOnline, onReconnecting, onOffline } = callbacks;
  const unhealthyThreshold = opts.unhealthyThreshold ?? 3;
  let failures = 0;

  async function checkNow(): Promise<boolean> {
    let healthy = false;
    try {
      healthy = await hermesClient.healthCheck();
    } catch {
      healthy = false;
    }
    if (healthy) {
      if (failures > 0) {
        failures = 0;
        onOnline?.();
      }
      return true;
    }
    failures += 1;
    if (failures === 1) onReconnecting?.();
    else if (failures === unhealthyThreshold) onOffline?.();
    return false;
  }

  const goOnline = () => {
    // Browser says the network is back — reset and verify the gateway itself.
    failures = 0;
    onOnline?.();
    void checkNow();
  };
  const goOffline = () => {
    failures = unhealthyThreshold;
    onOffline?.();
  };

  window.addEventListener("online", goOnline);
  window.addEventListener("offline", goOffline);

  // Also periodically health-check the Hermes endpoint
  let healthInterval: ReturnType<typeof setInterval> | null = null;

  function startHealthChecks(intervalMs = opts.intervalMs ?? 15_000) {
    stopHealthChecks();
    healthInterval = setInterval(() => {
      void checkNow();
    }, intervalMs);
  }

  function stopHealthChecks() {
    if (healthInterval) {
      clearInterval(healthInterval);
      healthInterval = null;
    }
  }

  return {
    destroy() {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      stopHealthChecks();
    },
    startHealthChecks,
    stopHealthChecks,
    checkNow,
  };
}
