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

import { describeError, diagnostics } from "./diagnostics";

const DEFAULT_BASE = "/api/v1";

// ── failure model ────────────────────────────────────────────────────────
// Every way a turn can fail gets a kind + a human reason, so the UI can say
// WHAT happened instead of "Connection lost". `retriable` drives the retry
// ladder: retrying a 401/403/404 just burns 12s and fails identically.
export type StreamFailureKind =
  | "aborted" // user pressed Stop — not a failure, never surfaced
  | "network" // fetch rejected, DNS/connection refused/socket reset
  | "timeout" // no response headers within firstByteTimeoutMs
  | "stall" // stream opened, then went silent past stallTimeoutMs
  | "http" // 4xx that isn't auth-shaped (bad request/model/session)
  | "auth" // 401/403 — bad or missing gateway API key
  | "server" // 5xx from the gateway
  | "truncated" // stream ended without [DONE], or finish_reason="length"
  | "agent-error"; // finish_reason="error" (+ gateway `error` field)

/** How long to wait for response headers / first byte. */
export const FIRST_BYTE_TIMEOUT_MS = 60_000;
/** How long the stream may go silent before we treat it as dead. The gateway
 *  emits a `: keepalive` comment every 30s of idle, so >2 intervals is safe. */
export const STALL_TIMEOUT_MS = 90_000;

export class StreamError extends Error {
  readonly kind: StreamFailureKind;
  readonly status?: number;
  readonly detail?: string;
  readonly retriable: boolean;
  /** Content already received for this attempt (a partial reply). */
  readonly partial?: string;

  constructor(kind: StreamFailureKind, message: string, opts: { status?: number; detail?: string; retriable?: boolean; partial?: string } = {}) {
    super(message);
    this.name = "StreamError";
    this.kind = kind;
    this.status = opts.status;
    this.detail = opts.detail;
    this.partial = opts.partial;
    this.retriable = opts.retriable ?? (kind !== "auth" && kind !== "http" && kind !== "aborted");
  }

  static fromStatus(status: number, detail: string, partial?: string): StreamError {
    if (status === 401 || status === 403) {
      return new StreamError("auth", `Gateway rejected the API key (HTTP ${status})`, { status, detail, partial });
    }
    if (status >= 500) {
      return new StreamError("server", `Gateway error (HTTP ${status})`, { status, detail, partial });
    }
    return new StreamError("http", `Request rejected (HTTP ${status})`, { status, detail, partial });
  }
}

export type StreamMessage = { role: string; content: string };

export type StreamUsage = {
  total_tokens?: number;
  completion_tokens?: number;
  prompt_tokens?: number;
};

export type ToolProgress = {
  tool?: string;
  emoji?: string;
  label?: string;
  toolCallId?: string;
  status?: "running" | "completed";
};

export type StreamCallbacks = {
  onToken: (text: string) => void;
  onDone?: () => void | Promise<void>;
  onError?: (err: unknown) => void | Promise<void>;
  onSessionId?: (id: string) => void;
  onUsage?: (usage: StreamUsage) => void;
  /** Agent tool lifecycle (`hermes.tool.progress` frames) — lets the bubble show
   *  what the agent is doing during a long turn instead of a bare spinner. */
  onToolProgress?: (progress: ToolProgress) => void;
};

export type StreamOptions = {
  agent?: string | null;
  apiKey?: string | null;
  sessionId?: string;
  model?: string;
  provider?: string;
  /** Label used in diagnostic events (defaults to the agent name). */
  label?: string;
  firstByteTimeoutMs?: number;
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

  constructor(baseUrl: string = DEFAULT_BASE) {
    this.baseUrl = baseUrl;
    this.apiKey = null;
    this.activeControllers = new Set();
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
  // NOTE: `/` and `/health` are NOT reliable here. Behind the Talaria dev/serve
  // front end they hit the SPA fallback (index.html, HTTP 200), so the gateway
  // can be dead and the check still says "healthy". `/v1/models` always goes to
  // the gateway (it is a proxied path) and answers 200 with a valid key, 401
  // with a bad/missing one — a real signal, and an actionable one.
  async probe({ apiKey, timeoutMs = 5000 }: { apiKey?: string | null; timeoutMs?: number } = {}): Promise<HealthResult> {
    const key = apiKey !== undefined && apiKey !== null ? apiKey : this.apiKey;
    const startedAt = Date.now();
    try {
      const r = await fetch(`${this.gatewayRoot()}/v1/models`, {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        signal: AbortSignal.timeout(timeoutMs),
      });
      const tookMs = Date.now() - startedAt;
      if (r.status === 401 || r.status === 403) {
        return { reachable: true, ok: false, status: r.status, tookMs, reason: "gateway rejected the API key" };
      }
      if (r.status >= 500) {
        return { reachable: false, ok: false, status: r.status, tookMs, reason: `gateway returned HTTP ${r.status}` };
      }
      return { reachable: true, ok: true, status: r.status, tookMs, reason: "gateway reachable" };
    } catch (err) {
      return { reachable: false, ok: false, tookMs: Date.now() - startedAt, reason: describeError(err).message as string };
    }
  }

  /** Boolean wrapper kept for callers that only need reachability. */
  async healthCheck(): Promise<boolean> {
    const res = await this.probe();
    return res.reachable;
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
  //
  // Failure visibility (the whole point of this file's error model): the
  // gateway reports a failed agent turn INSIDE the SSE body — a final chunk
  // with finish_reason="error" (or "length") plus an `error` field — and still
  // terminates with `data: [DONE]`. Reading only `delta.content` (as this used
  // to) made every failed turn look like a successful empty/partial reply. We
  // now parse finish_reason/error and hand the caller a StreamError with the
  // gateway's own message.
  // ---------------------------------------------------------------------------
  async streamChat(messages: Array<StreamMessage>, callbacks: StreamCallbacks, opts: StreamOptions = {}) {
    const { onToken, onDone, onError, onSessionId, onUsage, onToolProgress } = callbacks;
    const { agent, apiKey, sessionId, model, provider } = opts;
    const label = opts.label || agent || "default";
    const firstByteTimeoutMs = opts.firstByteTimeoutMs ?? FIRST_BYTE_TIMEOUT_MS;
    const stallTimeoutMs = opts.stallTimeoutMs ?? STALL_TIMEOUT_MS;

    const controller = new AbortController();
    this.activeControllers.add(controller);

    const url = this.chatUrl(agent);
    const startedAt = Date.now();
    const stats = { bytes: 0, chunks: 0, chars: 0, firstByteMs: 0, sawDone: false };
    let content = "";
    let failure: StreamError | null = null;
    let timedOut: "first-byte" | "stall" | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const armWatchdog = (ms: number, phase: "first-byte" | "stall") => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = phase;
        controller.abort();
      }, ms);
    };
    const release = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      this.activeControllers.delete(controller);
    };
    const partial = () => (content ? content.slice(0, 500) : undefined);

    // Handle a finish chunk: extract the gateway's own reason for a failed turn.
    const readFinishChunk = (parsed: Record<string, unknown>) => {
      const choice = (parsed.choices as Array<Record<string, unknown>> | undefined)?.[0];
      const finishReason = (choice?.finish_reason as string | null | undefined) ?? null;
      if (!finishReason || finishReason === "stop") return;
      const errField = parsed.error as { message?: string; type?: string } | undefined;
      const hermes = parsed.hermes as { error?: string; completed?: boolean; partial?: boolean } | undefined;
      const reason = errField?.message || hermes?.error || `Agent turn ended with finish_reason="${finishReason}"`;
      failure = new StreamError(finishReason === "length" ? "truncated" : "agent-error", reason, {
        detail: [errField?.type, hermes?.error].filter(Boolean).join(" · ") || undefined,
        retriable: finishReason !== "length",
        partial: partial(),
      });
      diagnostics.warn(`stream.${label}`, `Turn failed: ${finishReason}`, { reason, finishReason });
    };

    const readDataFrame = (frame: string) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(frame) as Record<string, unknown>;
      } catch {
        return; // unparseable frame — the gateway also sends `: keepalive` comments
      }
      if (onUsage && parsed.usage) onUsage(parsed.usage as StreamUsage);
      const choice = (parsed.choices as Array<Record<string, unknown>> | undefined)?.[0];
      const delta = choice?.delta as { content?: string } | undefined;
      if (delta?.content) {
        content += delta.content;
        stats.chars = content.length;
        onToken(delta.content);
      }
      if (choice?.finish_reason) readFinishChunk(parsed);
      if (!choice && parsed.tool && onToolProgress) onToolProgress(parsed as ToolProgress);
    };

    try {
      diagnostics.debug(`stream.${label}`, content === "" ? "Request sent" : "Retrying request", {
        url,
        model: model || "(profile default)",
        provider: provider || undefined,
        sessionId,
        messages: messages.length,
        chars: messages.reduce((n, m) => n + (m.content?.length || 0), 0),
      });

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const key = apiKey !== undefined ? apiKey : this.apiKey;
      if (key) {
        headers.Authorization = `Bearer ${key}`;
      } else {
        diagnostics.warn(`stream.${label}`, "No API key set — the gateway will reject this request with 401");
      }
      // Server-side session continuity: the gateway persists this turn to state.db
      // so every device reading the same session id sees the full history.
      if (sessionId) {
        headers["X-Hermes-Session-Id"] = sessionId;
      }

      const payload: Record<string, unknown> = {
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      };
      // Model/provider override: when supplied, the gateway uses these instead of
      // the profile's configured default (honored for explicit provider values).
      if (model) payload.model = model;
      if (provider) payload.provider = provider;

      armWatchdog(firstByteTimeoutMs, "first-byte");
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await readErrorDetail(response);
        const err = StreamError.fromStatus(response.status, detail, undefined);
        diagnostics.error(`stream.${label}`, err.message, { status: response.status, detail });
        release();
        await onError?.(err);
        return;
      }

      // Echo back the effective session id so the client can persist it.
      if (onSessionId) {
        const echo = response.headers.get("X-Hermes-Session-Id");
        if (echo) onSessionId(echo);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        diagnostics.warn(`stream.${label}`, "Response had no body stream — treating the turn as complete");
        release();
        await onDone?.();
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      armWatchdog(stallTimeoutMs, "stall");

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!stats.firstByteMs) {
          stats.firstByteMs = Date.now() - startedAt;
          diagnostics.debug(`stream.${label}`, "First bytes received", { firstByteMs: stats.firstByteMs });
        }
        armWatchdog(stallTimeoutMs, "stall");
        stats.bytes += value?.length || 0;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the last partial line in the buffer
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          // SSE comments (`: keepalive`) and event: lines carry no data frame.
          if (!trimmed || trimmed.startsWith(":")) continue;
          if (!trimmed.startsWith("data:")) continue;

          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") {
            stats.sawDone = true;
            continue;
          }
          stats.chunks++;
          readDataFrame(data);
        }
        if (stats.sawDone) break;
      }

      release();
      const tookMs = Date.now() - startedAt;
      if (failure) {
        const err = failure as StreamError;
        diagnostics.warn(`stream.${label}`, `Failed after ${tookMs}ms: ${err.message}`, {
          kind: err.kind,
          chars: stats.chars,
          partialKept: Boolean(err.partial),
        });
        await onError?.(err);
        return;
      }
      if (!stats.sawDone) {
        const err = new StreamError("truncated", "The reply stream ended early (no end-of-stream marker)", {
          detail: `bytes=${stats.bytes} chunks=${stats.chunks} chars=${stats.chars}`,
          partial: partial(),
        });
        diagnostics.warn(`stream.${label}`, err.message, { kind: err.kind, bytes: stats.bytes });
        await onError?.(err);
        return;
      }
      diagnostics.debug(`stream.${label}`, `Turn complete in ${tookMs}ms`, {
        firstByteMs: stats.firstByteMs,
        chars: stats.chars,
        chunks: stats.chunks,
        bytes: stats.bytes,
      });
      await onDone?.();
    } catch (err) {
      release();
      const tookMs = Date.now() - startedAt;
      if (err instanceof StreamError) {
        await onError?.(err);
        return;
      }
      // Abort: either the user pressed Stop, or one of our watchdogs fired.
      if (controller.signal.aborted) {
        if (timedOut) {
          const kind = timedOut === "first-byte" ? "timeout" : "stall";
          const message =
            timedOut === "first-byte"
              ? `No response from the gateway within ${Math.round(firstByteTimeoutMs / 1000)}s`
              : `Reply stalled — no data for ${Math.round(stallTimeoutMs / 1000)}s`;
          const streamErr = new StreamError(kind, message, { partial: partial() });
          diagnostics.error(`stream.${label}`, message, { kind, afterMs: tookMs, chars: stats.chars });
          await onError?.(streamErr);
          return;
        }
        diagnostics.debug(`stream.${label}`, "Stream aborted by the client");
        return; // user stop — silent, by design
      }
      const streamErr =
        err instanceof Error && err.name === "TimeoutError"
          ? new StreamError("timeout", `No response from the gateway within ${Math.round(firstByteTimeoutMs / 1000)}s`, { partial: partial() })
          : new StreamError("network", networkMessage(err), { detail: String((err as Error)?.message || err), partial: partial() });
      diagnostics.error(`stream.${label}`, streamErr.message, { kind: streamErr.kind, afterMs: tookMs, ...describeError(err) });
      await onError?.(streamErr);
    }
  }

  // Abort every in-flight stream (group fan-out safety).
  abort() {
    for (const c of this.activeControllers) {
      c.abort();
    }
    this.activeControllers.clear();
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
// Failure helpers
// ---------------------------------------------------------------------------

export type HealthResult = {
  /** Any HTTP response came back at all (the gateway is up and answering). */
  reachable: boolean;
  /** The gateway answered 2xx — the request would have been accepted. */
  ok: boolean;
  status?: number;
  tookMs: number;
  reason: string;
};

// Pull the gateway's own error text out of a non-2xx response. The API server
// answers with an OpenAI-style envelope: {"error":{"message":...}}.
async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return "empty response body";
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string; code?: string }; message?: string; detail?: string };
      const message = parsed.error?.message || parsed.message || parsed.detail || text;
      const code = parsed.error?.code ? ` (${parsed.error.code})` : "";
      return `${message}${code}`.slice(0, 400);
    } catch {
      return text.slice(0, 400);
    }
  } catch {
    return "could not read the response body";
  }
}

function networkMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return "Cannot reach the gateway (network error)";
  }
  return `Request failed: ${raw}`.slice(0, 200);
}

// ---------------------------------------------------------------------------
// Connection monitor — fires events when online/offline
// ---------------------------------------------------------------------------
export type ConnectionMonitorCallbacks = {
  onOnline?: () => void;
  onOffline?: () => void;
  /** Fired on every probe with the full result — reason text, latency, status. */
  onProbe?: (result: HealthResult) => void;
};

export type ConnectionMonitor = {
  destroy: () => void;
  startHealthChecks: (intervalMs?: number) => void;
  stopHealthChecks: () => void;
  /** Probe right now (the "tap to re-check" path). */
  checkNow: () => Promise<HealthResult>;
};

// One failed probe is NOT enough to call the gateway offline: a restart, a
// deploy or a dropped keepalive produces a single failure. Two consecutive
// failures (then every failure) flip to offline; any success flips back.
const OFFLINE_AFTER_FAILURES = 2;

export function createConnectionMonitor(callbacks: ConnectionMonitorCallbacks): ConnectionMonitor {
  const { onOnline, onOffline, onProbe } = callbacks;

  let failures = 0;
  let healthInterval: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<HealthResult> | null = null;

  const goOnline = () => onOnline?.();
  const goOffline = () => onOffline?.();

  const apply = (result: HealthResult) => {
    if (result.reachable) {
      failures = 0;
      goOnline();
    } else {
      failures++;
      if (failures >= OFFLINE_AFTER_FAILURES) goOffline();
    }
    onProbe?.(result);
  };

  const checkNow = async (): Promise<HealthResult> => {
    // Collapse concurrent probes (a tap while the interval timer is mid-flight).
    if (inFlight) return inFlight;
    inFlight = hermesClient.probe().then(
      (result) => {
        diagnostics.debug("health", `Probe: ${result.reason}`, { status: result.status, tookMs: result.tookMs });
        apply(result);
        inFlight = null;
        return result;
      },
      (err) => {
        inFlight = null;
        throw err;
      }
    );
    return inFlight;
  };

  window.addEventListener("online", goOnline);
  window.addEventListener("offline", goOffline);

  function startHealthChecks(intervalMs = 15_000) {
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
