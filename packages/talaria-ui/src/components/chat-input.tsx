import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useChatStore } from "../stores/chat";

type ChatInputProps = {
  onSend: (text: string) => void;
  onStop: () => void;
};

export function ChatInput({ onSend, onStop }: ChatInputProps) {
  const activeGroupMembers = useChatStore(useShallow((s) => s.activeGroupMembers()));
  const isStreaming = useChatStore((s) => s.isStreaming());
  const agentColor = useChatStore((s) => s.agentColor);
  const agentDisplay = useChatStore((s) => s.agentDisplay);
  const commands = useChatStore((s) => s.COMMANDS);

  const [text, setText] = useState("");
  const inputEl = useRef<HTMLTextAreaElement>(null);

  const placeholder =
    activeGroupMembers.length > 1
      ? "Message the group (@agent to direct)…"
      : activeGroupMembers.length === 1
        ? `Message ${agentDisplay(activeGroupMembers[0])}…`
        : "Message Hermes…";

  // Slash-command suggestion popover.
  const showSlashPanel = text.trim().startsWith("/") && !isStreaming;
  const idx = text.indexOf(" ");
  const prefix = (idx === -1 ? text : text.slice(0, idx)).trim().toLowerCase();
  const filteredCommands = commands.filter((c) => c.cmd.toLowerCase().startsWith(prefix));

  function resize() {
    const el = inputEl.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }

  function focusSoon() {
    requestAnimationFrame(() => {
      const el = inputEl.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }

  function applyCommand(cmd: string) {
    // Commands with args insert just the base token so the user can fill in.
    const base = cmd.split(" ")[0];
    setText(`${base} `);
    requestAnimationFrame(resize);
    focusSoon();
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setText("");
    requestAnimationFrame(resize);
  }

  // Insert an @mention token at the caret (or append). null → @all
  function insertMention(name: string | null) {
    const token = name ? `@${name} ` : "@all ";
    const el = inputEl.current;
    const start = el ? el.selectionStart || text.length : text.length;
    setText(text.slice(0, start) + token + text.slice(start));
    requestAnimationFrame(resize);
    focusSoon();
  }

  useEffect(() => {
    inputEl.current?.focus();
  }, []);

  return (
    <div className="px-3 py-3 border-t border-slate-800 shrink-0 bg-slate-900">
      {/* Group mention helper */}
      {activeGroupMembers.length > 1 && (
        <div className="flex items-center gap-1.5 mb-2 overflow-x-auto pb-0.5">
          <span className="text-[11px] uppercase tracking-wider text-slate-500 shrink-0">@</span>
          {activeGroupMembers.map((name) => (
            <button
              type="button"
              key={name}
              onClick={() => insertMention(name)}
              className="flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-colors shrink-0 border border-slate-700"
              style={{ backgroundColor: `${agentColor(name)}1a`, color: agentColor(name) }}
              title={`Mention ${agentDisplay(name)}`}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: agentColor(name) }} />
              {agentDisplay(name)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => insertMention(null)}
            className="px-2 py-1 rounded-full text-xs transition-colors shrink-0 border border-slate-700 text-slate-300 hover:bg-slate-800"
            title="Mention all agents"
          >
            @all
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Text area (auto-grows) */}
        <div className="flex-1 relative">
          {/* Slash command suggestions */}
          {showSlashPanel && (
            <div className="absolute bottom-full left-0 mb-2 w-72 max-h-56 overflow-y-auto bg-slate-800 rounded-xl border border-slate-700 shadow-xl z-20 py-1">
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-700/60">Commands</div>
              {filteredCommands.map((c) => (
                <button
                  type="button"
                  key={c.cmd}
                  onClick={() => applyCommand(c.cmd)}
                  className="w-full text-left flex items-start justify-between gap-2 px-3 py-2 text-xs hover:bg-slate-700/60 transition-colors"
                >
                  <span className="text-blue-300 font-mono shrink-0">{c.cmd}</span>
                  <span className="text-slate-400 text-right leading-tight">{c.desc}</span>
                </button>
              ))}
              {filteredCommands.length === 0 && <div className="px-3 py-2 text-xs text-slate-500">No matching commands</div>}
            </div>
          )}
          <textarea
            ref={inputEl}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                submit();
              }
            }}
            onInput={resize}
            rows={1}
            disabled={isStreaming}
            placeholder={placeholder}
            className="w-full bg-slate-800 text-sm rounded-xl px-4 py-2.5 pr-10 resize-none
                   border-none outline-none focus:ring-2 focus:ring-blue-500/50
                   placeholder-slate-500 text-slate-100 max-h-32"
          />
          {/* Clear button */}
          {text && !isStreaming && (
            <button
              type="button"
              onClick={() => setText("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-300"
              aria-label="Clear input"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {isStreaming ? (
          /* Stop button (while streaming) */
          <button
            type="button"
            onClick={onStop}
            className="shrink-0 w-10 h-10 flex items-center justify-center
               bg-red-600 hover:bg-red-700 rounded-full transition-colors"
            aria-label="Stop generating"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        ) : (
          /* Send button */
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim()}
            className={`shrink-0 w-10 h-10 flex items-center justify-center
               rounded-full transition-all ${
                 text.trim() ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-slate-800 text-slate-600 cursor-not-allowed"
               }`}
            aria-label="Send"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
