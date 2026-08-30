import { useEffect, useState } from "react";
import { useGitHubStore } from "../stores/github";

// GitHub connection section for the Settings modal — the "Login with GitHub"
// button (OAuth device flow), the device-code screen, the fine-grained PAT
// fallback field, and the list of connected accounts with Disconnect. Token
// stays on the user's machine (desktop) or gateway (web) — never on Talaria.
export function GitHubConnect() {
  const connections = useGitHubStore((s) => s.connections);
  const deviceFlow = useGitHubStore((s) => s.deviceFlow);
  const platform = useGitHubStore((s) => s.platform);
  const startDeviceFlow = useGitHubStore((s) => s.startDeviceFlow);
  const stopDeviceFlow = useGitHubStore((s) => s.stopDeviceFlow);
  const pollDeviceFlow = useGitHubStore((s) => s.pollDeviceFlow);
  const connectWithPat = useGitHubStore((s) => s.connectWithPat);
  const disconnect = useGitHubStore((s) => s.disconnect);

  const [patInput, setPatInput] = useState("");
  const [patBusy, setPatBusy] = useState(false);
  const [patError, setPatError] = useState<string | null>(null);

  // Poll the device flow while it's active (respecting GitHub's interval).
  useEffect(() => {
    if (!deviceFlow.active || !deviceFlow.handle || deviceFlow.polling) return;
    const interval = (deviceFlow.handle.interval || 5) * 1000;
    const t = setTimeout(() => {
      pollDeviceFlow();
    }, interval);
    return () => clearTimeout(t);
  }, [deviceFlow.active, deviceFlow.handle, deviceFlow.polling, pollDeviceFlow]);

  async function handlePatConnect() {
    setPatBusy(true);
    setPatError(null);
    try {
      await connectWithPat(patInput);
      setPatInput("");
    } catch (err) {
      setPatError(err instanceof Error ? err.message : "Could not connect with PAT");
    } finally {
      setPatBusy(false);
    }
  }

  return (
    <div className="pt-1">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs font-medium text-slate-500">GitHub connection</p>
        <span className="text-[10px] text-slate-600">{platform === "desktop" ? "desktop · direct" : "web · via gateway"}</span>
      </div>

      {/* Connected accounts */}
      {connections.length > 0 && (
        <ul className="divide-y divide-slate-800/60 mb-3">
          {connections.map((conn) => (
            <li key={conn.id} className="flex items-center gap-3 py-2">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  conn.status === "connected" ? "bg-emerald-400" : conn.status === "reconnecting" ? "bg-amber-400" : "bg-red-400"
                }`}
              />
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-slate-200 truncate">{conn.owner}</span>
                <span className="block text-xs text-slate-500 font-mono truncate">
                  {conn.type === "device" ? "OAuth device flow" : "Fine-grained PAT"}
                  {conn.status === "reconnecting" ? " · needs re-auth" : ""}
                </span>
              </span>
              <button
                type="button"
                onClick={() => disconnect(conn.id)}
                className="text-xs text-red-400 hover:text-red-300 transition-colors shrink-0"
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Device flow */}
      {!deviceFlow.active ? (
        <button
          type="button"
          onClick={startDeviceFlow}
          className="w-full py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm font-medium text-slate-200 transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          Login with GitHub
        </button>
      ) : (
        <div className="bg-slate-800/50 rounded-lg p-3 space-y-2">
          {deviceFlow.error ? (
            <>
              <p className="text-xs text-red-400">{deviceFlow.error}</p>
              <button
                type="button"
                onClick={startDeviceFlow}
                className="w-full py-1.5 rounded-lg bg-slate-800 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-colors"
              >
                Restart
              </button>
            </>
          ) : deviceFlow.handle ? (
            <>
              <p className="text-xs text-slate-400">
                Open{" "}
                <a
                  className="text-blue-400 hover:underline"
                  href={deviceFlow.handle.verification_uri}
                  target="_blank"
                  rel="noreferrer"
                >
                  {deviceFlow.handle.verification_uri}
                </a>{" "}
                and enter this code:
              </p>
              <p className="text-center font-mono text-2xl tracking-[0.3em] text-slate-100 py-1 select-all">
                {deviceFlow.handle.user_code}
              </p>
              <button
                type="button"
                onClick={pollDeviceFlow}
                disabled={deviceFlow.polling}
                className="w-full py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-medium text-white transition-colors disabled:opacity-50"
              >
                {deviceFlow.polling ? "Waiting…" : "I've authorized — continue"}
              </button>
              <button
                type="button"
                onClick={stopDeviceFlow}
                className="w-full py-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <p className="text-xs text-slate-400">Starting device flow…</p>
          )}
        </div>
      )}

      {/* PAT fallback */}
      <div className="mt-3">
        <label className="block text-xs font-medium text-slate-400 mb-1.5" htmlFor="settings-github-pat">
          Fine-grained PAT (fallback)
        </label>
        <input
          id="settings-github-pat"
          value={patInput}
          onChange={(e) => setPatInput(e.target.value)}
          type="password"
          placeholder="ghp_… / github_pat_…"
          className="w-full bg-slate-800 text-sm rounded-lg px-3 py-2.5 border-none outline-none
               focus:ring-2 focus:ring-blue-500/50 text-slate-100 placeholder-slate-600"
        />
        {patError && <p className="text-xs text-red-400 mt-1">{patError}</p>}
        <button
          type="button"
          onClick={handlePatConnect}
          disabled={patBusy || !patInput.trim()}
          className={`mt-2 w-full py-2 rounded-lg text-sm font-medium transition-colors ${
            patBusy || !patInput.trim()
              ? "bg-slate-800 text-slate-500 cursor-not-allowed"
              : "bg-slate-700 hover:bg-slate-600 text-slate-100"
          }`}
        >
          {patBusy ? "Verifying…" : "Connect with PAT"}
        </button>
        <p className="text-[11px] text-slate-600 mt-1.5">
          Needs <code className="text-slate-500">repo</code> + <code className="text-slate-500">workflow</code>{" "}
          scopes (or a fine-grained token with repo / PR / actions access). Stored only on your machine.
        </p>
      </div>
    </div>
  );
}
