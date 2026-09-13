import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { diagnostics, type DiagnosticEvent, type DiagnosticLevel } from "../services/diagnostics";

const LEVEL_STYLE: Record<DiagnosticLevel, string> = {
  debug: "text-slate-500",
  info: "text-sky-400",
  warn: "text-amber-400",
  error: "text-red-400",
};

const LEVEL_BADGE: Record<DiagnosticLevel, string> = {
  debug: "bg-slate-700 text-slate-300",
  info: "bg-sky-900/60 text-sky-300",
  warn: "bg-amber-900/60 text-amber-300",
  error: "bg-red-900/60 text-red-300",
};

type Filter = "all" | "issues" | "error";

function clockTime(at: number): string {
  const d = new Date(at);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/**
 * Live chat diagnostics console — the "why did that fail" panel.
 *
 * Every layer (send → stream → gateway response → retry → health probe) drops a
 * structured event here, so a failure can be read instead of guessed at. Kept
 * deliberately plain: timestamps, level, scope, message, expandable JSON.
 */
export function DebugPanel({ onClose }: { onClose: () => void }) {
  const events = useSyncExternalStore(diagnostics.subscribe, diagnostics.snapshot);
  const verbose = useSyncExternalStore(diagnostics.subscribe, diagnostics.isVerbose);
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  const shown = filter === "all" ? events : events.filter((e) => e.level === "error" || (filter === "issues" && e.level === "warn"));

  // Follow the tail only while the user is already at the bottom.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  const lastId = shown.length > 0 ? shown[shown.length - 1].id : 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(diagnostics.toText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, []);

  const counts = {
    warn: events.filter((e) => e.level === "warn").length,
    error: events.filter((e) => e.level === "error").length,
  };

  const filterButton = (value: Filter, label: string) => (
    <button
      type="button"
      key={value}
      onClick={() => setFilter(value)}
      className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
        filter === value ? "bg-slate-600 text-slate-100" : "text-slate-400 hover:bg-slate-700/60"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="shrink-0 border-t border-slate-700 bg-slate-950/95 flex flex-col h-[38%] min-h-[180px]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-800 shrink-0">
        <span className="text-[11px] font-semibold text-slate-300">Diagnostics</span>
        <span className="text-[10px] text-slate-500">
          {events.length} events
          {counts.warn ? ` · ${counts.warn} warn` : ""}
          {counts.error ? ` · ${counts.error} error` : ""}
        </span>
        <div className="flex items-center gap-1 ml-2">
          {filterButton("all", "All")}
          {filterButton("issues", "Warnings+")}
          {filterButton("error", "Errors")}
        </div>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-[10px] text-slate-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={verbose}
            onChange={(e) => diagnostics.setVerbose(e.target.checked)}
            className="accent-sky-500 w-3 h-3"
          />
          Verbose (per-chunk detail + browser console)
        </label>
        <button type="button" onClick={() => void copy()} className="text-[10px] px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors">
          {copied ? "Copied" : "Copy log"}
        </button>
        <button type="button" onClick={() => diagnostics.clear()} className="text-[10px] px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors">
          Clear
        </button>
        <button type="button" onClick={onClose} aria-label="Close diagnostics" className="p-0.5 rounded hover:bg-slate-700 text-slate-400 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Event stream */}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto font-mono text-[11px] leading-relaxed px-3 py-1.5 space-y-0.5">
        {shown.length === 0 && (
          <p className="text-slate-600 py-2">
            {events.length === 0 ? "No events yet — send a message and the whole chat pipeline will report here." : "No events match this filter."}
          </p>
        )}
        {shown.map((e: DiagnosticEvent) => (
          <div key={e.id} className="flex items-start gap-2">
            <span className="text-slate-600 shrink-0">{clockTime(e.at)}</span>
            <span className={`shrink-0 px-1 rounded ${LEVEL_BADGE[e.level]}`}>{e.level}</span>
            <span className="text-slate-500 shrink-0 max-w-[160px] truncate">{e.scope}</span>
            <span className={`${LEVEL_STYLE[e.level]} break-words min-w-0`}>{e.message}</span>
            {e.data && (
              <button
                type="button"
                onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                className="shrink-0 text-[10px] text-slate-500 hover:text-slate-300 underline underline-offset-2"
              >
                {expanded === e.id ? "hide" : "data"}
              </button>
            )}
            {e.data && expanded === e.id && (
              <pre className="w-full mt-0.5 mb-1 text-[10px] text-slate-400 whitespace-pre-wrap break-all bg-slate-900/70 rounded px-2 py-1 border border-slate-800">
                {JSON.stringify(e.data, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
