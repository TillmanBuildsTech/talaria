import { useChatStore } from "../stores/chat";

export function ConnectionBanner() {
  const connectionStatus = useChatStore((s) => s.connectionStatus);

  const banner =
    connectionStatus === "offline"
      ? "Offline — waiting for connection…"
      : connectionStatus === "reconnecting"
        ? "Reconnecting…"
        : null;

  if (!banner) return null;

  const bannerClass =
    connectionStatus === "offline" ? "bg-amber-600/90 text-amber-50" : "bg-blue-600/90 text-blue-50";

  return (
    <div className="shrink-0">
      <div className={`flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium text-center transition-colors ${bannerClass}`}>
        {connectionStatus === "offline" ? (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M18.364 5.636a9 9 0 010 12.728m-2.829-2.829a5 5 0 000-7.07m-7.072 7.072a5 5 0 010-7.07m9.9 12.728a11.99 11.99 0 01-12.728 0"
            />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        )}
        {banner}
      </div>
    </div>
  );
}
