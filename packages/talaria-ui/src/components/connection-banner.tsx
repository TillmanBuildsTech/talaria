import { useChatStore } from "../stores/chat";

// Always-visible gateway status dot for the header. Green = the gateway answered
// the last health probe, amber = unreachable, blue = still connecting. Clicking
// it forces an immediate probe (and a failed turn auto-retries once it is back).
export function ConnectionDot() {
  const connectionStatus = useChatStore((s) => s.connectionStatus);
  const connectionDetail = useChatStore((s) => s.connectionDetail);
  const checkConnection = useChatStore((s) => s.checkConnection);

  const color =
    connectionStatus === "connected" ? "bg-emerald-400" : connectionStatus === "connecting" || connectionStatus === "reconnecting" ? "bg-blue-400 animate-pulse" : "bg-amber-400";
  const label =
    connectionStatus === "connected" ? "Gateway connected" : connectionStatus === "connecting" ? "Connecting to the gateway…" : connectionStatus === "reconnecting" ? "Reconnecting to the gateway…" : "Gateway unreachable";

  return (
    <button
      type="button"
      onClick={() => void checkConnection()}
      title={`${label}${connectionDetail ? ` — ${connectionDetail}` : ""} (click to re-check)`}
      aria-label={label}
      className="p-1.5 rounded-lg hover:bg-slate-800 transition-colors shrink-0"
    >
      <span className={`block w-2 h-2 rounded-full ${color}`} />
    </button>
  );
}

// Banner strip for the states the user must notice. It carries the REASON
// ("gateway returned HTTP 502", "API key rejected") and a one-tap re-check,
// instead of a bare "Offline — waiting for connection…".
export function ConnectionBanner() {
  const connectionStatus = useChatStore((s) => s.connectionStatus);
  const connectionDetail = useChatStore((s) => s.connectionDetail);
  const checkConnection = useChatStore((s) => s.checkConnection);

  if (connectionStatus === "connected") return null;

  const copy =
    connectionStatus === "offline"
      ? "Offline — the gateway is not answering"
      : connectionStatus === "connecting"
        ? "Connecting to the gateway…"
        : "Reconnecting to the gateway…";

  const bannerClass = connectionStatus === "offline" ? "bg-amber-600/90 text-amber-50" : "bg-blue-600/90 text-blue-50";

  return (
    <div className="shrink-0">
      <div className={`flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium text-center transition-colors ${bannerClass}`}>
        {connectionStatus === "offline" ? (
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M18.364 5.636a9 9 0 010 12.728m-2.829-2.829a5 5 0 000-7.07m-7.072 7.072a5 5 0 010-7.07m9.9 12.728a11.99 11.99 0 01-12.728 0"
            />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5 shrink-0 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        )}
        <span>{copy}</span>
        {connectionDetail && <span className="font-mono text-[10px] opacity-80 truncate max-w-[45%]">{connectionDetail}</span>}
        <button
          type="button"
          onClick={() => void checkConnection()}
          className="underline underline-offset-2 hover:opacity-80 transition-opacity"
        >
          Check now
        </button>
      </div>
    </div>
  );
}
