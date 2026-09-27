import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useRef, useState } from "react";
import type { ChatMessage as ChatMessageType } from "../db";
import { useChatStore } from "../stores/chat";

marked.setOptions({ gfm: true, breaks: true });

// After this long with no visible output we say so explicitly instead of
// showing an unexplained spinner ("I don't know what's going on").
const WAITING_HINT_MS = 8000;

function fmt(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

// Human wording for a transport failure kind (matches StreamFailureKind).
const FAILURE_LABEL: Record<string, string> = {
  auth: "API key rejected",
  http: "Request rejected",
  network: "Network error",
  server: "Gateway error",
  stall: "Reply stalled",
  timeout: "Gateway timed out",
  truncated: "Reply cut short",
  "agent-error": "Agent failed",
  aborted: "Stopped",
};

type ChatMessageProps = {
  message: ChatMessageType;
  onRetry: () => void;
};

export function ChatMessage({ message, onRetry }: ChatMessageProps) {
  const agents = useChatStore((s) => s.agents);
  const agentDisplay = useChatStore((s) => s.agentDisplay);
  const agentColor = useChatStore((s) => s.agentColor);

  const rendered = DOMPurify.sanitize(marked.parse(message.content || "") as string);
  const isThinking = message.status === "streaming" && !(message.content || "").trim();

  // Live clock used to show elapsed time while a reply is streaming.
  const [now, setNow] = useState(Date.now());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    if (message.status === "streaming") {
      timer.current = setInterval(() => setNow(Date.now()), 500);
    }
    return () => {
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, [message.status]);

  const elapsedText = message.elapsedMs != null ? fmt(message.elapsedMs) : message.status === "streaming" && message.startedAt ? fmt(now - message.startedAt) : null;
  const tokensText = message.tokens != null ? `${message.tokens.toLocaleString()} tok` : null;
  const waitingMs = message.status === "streaming" && message.startedAt ? now - message.startedAt : 0;
  const showWaitingHint = isThinking && !message.toolStatus && waitingMs > WAITING_HINT_MS;

  // Badge above a message:
  //  - user message that @'d specific agents → "@Developer" chips
  //  - assistant reply in a DM/group → author agent name
  const badge: Array<string> | null = message.system
    ? null
    : message.role === "user"
      ? (() => {
          const t = message.targetAgents || [];
          return t.length && t.length < 4 ? t.map((n) => `@${agentDisplay(n)}`) : null;
        })()
      : message.agentName
        ? [agentDisplay(message.agentName) || message.agentName]
        : null;

  function badgeColorFor(b: string): string {
    const name = b.replace(/^@/, "");
    const agent = agents.find((a) => a.displayName === name || a.name === name);
    return agent ? agentColor(agent.name) : "#94a3b8";
  }

  const bubbleClass =
    message.role === "user"
      ? "bg-blue-600 text-white rounded-br-md"
      : message.status === "failed"
        ? "bg-red-900/40 text-red-200 border border-red-500/30 rounded-bl-md"
        : message.system
          ? "bg-slate-900 text-slate-400 italic border border-slate-800 rounded-bl-md text-xs"
          : "bg-slate-800 text-slate-100 rounded-bl-md";

  const failureLabel = message.errorKind ? FAILURE_LABEL[message.errorKind] || message.errorKind : "Failed";
  const attemptText = typeof message.attempts === "number" && message.attempts > 1 ? `${message.attempts} attempts` : null;

  return (
    <div className={`flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}>
      {/* Target/author badge: for user @mentions and for assistant replies */}
      {badge && (
        <div className="flex items-center gap-1 text-[11px] mb-1 px-1">
          {badge.map((b, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: badge chips are a fixed, order-stable list per render
            <span key={i} style={{ color: badgeColorFor(b) }}>
              {b.startsWith("@") ? b : `${b} ·`}
            </span>
          ))}
        </div>
      )}

      <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed break-words ${bubbleClass}`}>
        {/* Content */}
        {isThinking ? (
          <div className="flex items-center gap-2">
            <div className="thinking-dots" aria-label="Thinking">
              <span />
              <span />
              <span />
            </div>
            {message.toolStatus && <span className="text-[11px] text-slate-400 truncate max-w-[280px]">{message.toolStatus}</span>}
            {showWaitingHint && (
              <span className="text-[11px] text-slate-500">waiting for the gateway ({fmt(waitingMs)})…</span>
            )}
          </div>
        ) : (
          // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized via DOMPurify before render
          <div className="markdown" dangerouslySetInnerHTML={{ __html: rendered }} />
        )}

        {/* Streaming cursor (only once tokens are actually flowing) */}
        {message.status === "streaming" && !isThinking && (
          <span className="inline-block w-2 h-4 ml-0.5 bg-blue-400 animate-pulse align-text-bottom rounded-sm" />
        )}

        {/* Tool activity while streaming (a long turn must not look frozen) */}
        {message.status === "streaming" && !isThinking && message.toolStatus && (
          <div className="mt-1.5 pt-1.5 border-t border-slate-700/40 text-[10px] text-slate-400 truncate">{message.toolStatus}</div>
        )}

        {/* Elapsed + token count (assistant replies) */}
        {!message.system && message.role === "assistant" && (elapsedText || tokensText) && (
          <div className="mt-1.5 pt-1.5 border-t border-slate-700/40 text-[10px] text-slate-500 flex items-center gap-2">
            {elapsedText && <span>{elapsedText}</span>}
            {tokensText && <span>{tokensText}</span>}
            {message.status === "streaming" && (
              <span className="inline-flex items-center gap-1 text-slate-600">
                <span className="w-1 h-1 rounded-full bg-slate-500 animate-pulse" />
                streaming
              </span>
            )}
          </div>
        )}

        {/* Failed state — say WHAT failed, not just "tap to retry" */}
        {!message.system && message.status === "failed" && (
          <div className="mt-2 pt-2 border-t border-red-500/30">
            <div className="flex items-start gap-2">
              <svg className="w-3.5 h-3.5 mt-0.5 shrink-0 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
              <div className="min-w-0">
                <p className="text-xs text-red-200 break-words">{message.errorText || "The reply failed."}</p>
                <p className="text-[10px] text-red-400/80 font-mono mt-0.5 break-words">
                  {failureLabel}
                  {attemptText ? ` · ${attemptText}` : ""}
                  {message.retriable === false ? " · retrying will not help" : ""}
                </p>
              </div>
            </div>
            {message.errorKind === "auth" && (
              <p className="text-[10px] text-amber-300/90 mt-1">Check this agent's API key in Settings → Agents.</p>
            )}
            <button
              type="button"
              onClick={onRetry}
              className="mt-1.5 text-xs text-red-300 hover:text-red-200 underline underline-offset-2 transition-colors"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
