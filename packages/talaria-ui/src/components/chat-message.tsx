import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useRef, useState } from "react";
import type { ChatMessage as ChatMessageType } from "../db";
import { useChatStore } from "../stores/chat";

marked.setOptions({ gfm: true, breaks: true });

function fmt(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

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
          <div className="thinking-dots" aria-label="Thinking">
            <span />
            <span />
            <span />
          </div>
        ) : (
          // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized via DOMPurify before render
          <div className="markdown" dangerouslySetInnerHTML={{ __html: rendered }} />
        )}

        {/* Streaming cursor (only once tokens are actually flowing) */}
        {message.status === "streaming" && !isThinking && (
          <span className="inline-block w-2 h-4 ml-0.5 bg-blue-400 animate-pulse align-text-bottom rounded-sm" />
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

        {/* Failed state */}
        {!message.system && message.status === "failed" && (
          <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-red-500/30">
            <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
            <button type="button" onClick={onRetry} className="text-xs text-red-400 hover:text-red-300 underline transition-colors">
              Tap to retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
