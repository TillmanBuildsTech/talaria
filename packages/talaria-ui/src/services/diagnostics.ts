// Verbose chat diagnostics.
//
// The chat used to fail silently: every transport/store error was swallowed by
// a bare `catch {}` and the user only saw "Tap to retry" with no reason. This
// module is the single sink for those reasons so they can be *seen* (debug
// panel + console) and copied into a bug report.
//
// Design:
//   - A bounded ring buffer (MAX_EVENTS) of structured events. Always recording
//     info/warn/error; `debug()` entries are only recorded while verbose mode is
//     on, so per-token logging can't grow the buffer without being asked for.
//   - `subscribe()` + `snapshot()` for React's useSyncExternalStore.
//   - Verbose mode is persisted so it survives reloads while developing.

export type DiagnosticLevel = "debug" | "info" | "warn" | "error";

export type DiagnosticEvent = {
  id: number;
  at: number;
  level: DiagnosticLevel;
  /** Area of the app that emitted it, e.g. "chat.send", "stream.developer". */
  scope: string;
  message: string;
  data?: Record<string, unknown>;
};

const MAX_EVENTS = 400;
const STORAGE_KEY = "talaria.diagnostics.verbose";

function readVerbose(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

// Error → plain object so it survives JSON.stringify in a copy/paste.
export function describeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: (err.stack || "").split("\n").slice(0, 4).join(" | ") };
  }
  if (typeof err === "object" && err !== null) return { ...(err as Record<string, unknown>) };
  return { message: String(err) };
}

export class DiagnosticsLog {
  private events: Array<DiagnosticEvent> = [];
  private readonly listeners = new Set<() => void>();
  private nextId = 1;
  private verbose: boolean;

  constructor() {
    this.verbose = readVerbose();
  }

  isVerbose = (): boolean => this.verbose;

  setVerbose = (on: boolean): void => {
    if (this.verbose === on) return;
    this.verbose = on;
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, on ? "1" : "0");
    } catch {
      /* private mode / no storage — session-only */
    }
    this.record("info", "diagnostics", on ? "Verbose logging enabled" : "Verbose logging disabled");
  };

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  // Stable array reference between mutations (useSyncExternalStore contract).
  snapshot = (): Array<DiagnosticEvent> => this.events;

  record = (level: DiagnosticLevel, scope: string, message: string, data?: Record<string, unknown>): void => {
    if (level === "debug" && !this.verbose) return;
    const event: DiagnosticEvent = { id: this.nextId++, at: Date.now(), level, scope, message };
    if (data && Object.keys(data).length > 0) event.data = data;
    const next = this.events.length >= MAX_EVENTS ? this.events.slice(this.events.length - MAX_EVENTS + 1) : this.events.slice();
    next.push(event);
    this.events = next;
    if (this.verbose && level !== "debug") {
      const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
      fn(`[talaria:${scope}] ${message}`, data ?? "");
    }
    for (const fn of this.listeners) fn();
  };

  debug = (scope: string, message: string, data?: Record<string, unknown>): void => this.record("debug", scope, message, data);
  info = (scope: string, message: string, data?: Record<string, unknown>): void => this.record("info", scope, message, data);
  warn = (scope: string, message: string, data?: Record<string, unknown>): void => this.record("warn", scope, message, data);
  error = (scope: string, message: string, data?: Record<string, unknown>): void => this.record("error", scope, message, data);

  clear = (): void => {
    this.events = [];
    for (const fn of this.listeners) fn();
  };

  // Human-readable dump for the "Copy" button in the debug panel.
  toText = (): string =>
    this.events
      .map((e) => {
        const ts = new Date(e.at).toISOString().slice(11, 23);
        const data = e.data ? ` ${JSON.stringify(e.data)}` : "";
        return `${ts} ${e.level.toUpperCase().padEnd(5)} [${e.scope}] ${e.message}${data}`;
      })
      .join("\n");
}

export const diagnostics = new DiagnosticsLog();
