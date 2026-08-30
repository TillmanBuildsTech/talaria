import { useEffect, useRef, useState } from "react";
import { ChatInput } from "./components/chat-input";
import { ChatMessage } from "./components/chat-message";
import { ConnectionBanner } from "./components/connection-banner";
import { Deployments } from "./components/deployments";
import { NavRail, type NavModuleId } from "./components/nav-rail";
import { ProjectPicker } from "./components/project-picker";
import { PrPanel } from "./components/pr-panel";
import { RepoBrowser } from "./components/repo-browser";
import { SettingsPage } from "./components/settings-page";
import { Sidebar } from "./components/sidebar";
import { useChatStore } from "./stores/chat";
import { useGitHubStore } from "./stores/github";
import { useProjectsStore } from "./stores/projects";

function fmtTokens(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return String(n);
}

// Slide-in/out sidebar without pulling in an animation library: keep the
// panel mounted for one transition duration after close so the CSS
// transform can animate out before it unmounts.
function useSlidePresence(open: boolean, durationMs = 250) {
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    let raf = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (open) {
      setMounted(true);
      raf = requestAnimationFrame(() => setEntered(true));
    } else {
      setEntered(false);
      timeout = setTimeout(() => setMounted(false), durationMs);
    }
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
  }, [open, durationMs]);

  return { mounted, entered };
}

export function App() {
  const store = useChatStore();
  const [showSidebar, setShowSidebar] = useState(false);
  const [module, setModule] = useState<NavModuleId>("chat");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [showModelMenu, setShowModelMenu] = useState(false);

  const chatContainer = useRef<HTMLDivElement>(null);
  const scrollAnchor = useRef<HTMLDivElement>(null);
  const headerTitleInput = useRef<HTMLInputElement>(null);

  const sidebar = useSlidePresence(showSidebar);

  const activeConversationId = store.activeConversationId;
  const activeContextTokens = store.activeContextTokens();
  const activeContextWindow = store.activeContextWindow();
  const activeModelName = store.activeModelName();
  const configuredModels = store.configuredModels();
  const activeConvTitle = store.activeConvTitle();

  function contextLevel(): "red" | "amber" | "green" {
    const w = activeContextWindow || 1;
    const r = activeContextTokens / w;
    if (r >= 0.85) return "red";
    if (r >= 0.6) return "amber";
    return "green";
  }
  const level = contextLevel();
  const contextBarClass = { red: "bg-red-500", amber: "bg-amber-500", green: "bg-emerald-500" }[level];
  const modelDotClass = { red: "bg-red-400", amber: "bg-amber-400", green: "bg-emerald-400" }[level];
  const contextWidth = `${Math.min(100, (activeContextTokens / (activeContextWindow || 1)) * 100)}%`;

  function selectModel(modelName: string | null) {
    store.setConversationModel(modelName);
    setShowModelMenu(false);
  }

  function startTitleEdit() {
    if (!activeConversationId) return;
    setTitleDraft(activeConvTitle);
    setEditingTitle(true);
  }

  useEffect(() => {
    if (editingTitle) {
      headerTitleInput.current?.focus();
      headerTitleInput.current?.select();
    }
  }, [editingTitle]);

  function saveTitleEdit() {
    if (editingTitle && activeConversationId) {
      store.renameConversation(activeConversationId, titleDraft);
    }
    setEditingTitle(false);
  }

  // Auto-scroll to bottom on new messages
  function scrollToBottom() {
    requestAnimationFrame(() => {
      scrollAnchor.current?.scrollIntoView({ behavior: "smooth" });
    });
  }

  const messages = store.messages;
  const lastContent = messages.length > 0 ? messages[messages.length - 1].content : "";
  useEffect(() => {
    scrollToBottom();
    // biome-ignore lint/correctness/useExhaustiveDependencies: mirrors the original two watchers (length + last message content)
  }, [messages.length, lastContent]);

  useEffect(() => {
    (async () => {
      await store.init();
      await useGitHubStore.getState().init();
      scrollToBottom();
    })();
    // biome-ignore lint/correctness/useExhaustiveDependencies: init once on mount, matching the Vue onMounted hook
  }, []);

  function handleSend(text: string) {
    store.sendMessage(text);
  }

  // Initialize the projects store alongside chat on first mount.
  const projectsInit = useProjectsStore((s) => s.init);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const reloadForScope = useChatStore((s) => s.reloadForScope);

  useEffect(() => {
    (async () => {
      await projectsInit();
    })();
    // biome-ignore lint/correctness/useExhaustiveDependencies: init once on mount
  }, []);

  // Switching project scope swaps the whole view/data namespace (P9): re-query
  // the chat store against the new scope whenever the active project changes.
  useEffect(() => {
    reloadForScope();
    // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate reload on scope change
  }, [activeProjectId]);

  return (
    <div className="flex flex-col h-dvh bg-slate-900 text-slate-100 overflow-hidden">
      <ConnectionBanner />

      {/* Top bar */}
      <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-800 shrink-0">
        {/* Project scope picker */}
        <ProjectPicker />
        <button
          type="button"
          onClick={() => setShowSidebar((v) => !v)}
          className="p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
          aria-label="Conversations"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              ref={headerTitleInput}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveTitleEdit();
                } else if (e.key === "Escape") {
                  setEditingTitle(false);
                }
              }}
              onBlur={saveTitleEdit}
              className="w-full bg-slate-900 text-sm font-semibold rounded px-1.5 py-0.5 outline-none ring-1 ring-blue-500 text-slate-100"
            />
          ) : (
            <button
              type="button"
              className="w-full flex items-center gap-1.5 text-left group"
              disabled={!activeConversationId}
              onClick={startTitleEdit}
            >
              <span className="text-sm font-semibold truncate">{activeConvTitle}</span>
              {activeConversationId && (
                <svg
                  className="w-3.5 h-3.5 text-slate-500 opacity-0 group-hover:opacity-100 shrink-0 transition-opacity"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
              )}
            </button>
          )}
        </div>

        {/* Model picker + context (only once a conversation is open) */}
        {activeConversationId && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setShowModelMenu((v) => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs transition-colors"
              title={`Model for this conversation (${fmtTokens(activeContextWindow)} context)`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${modelDotClass}`} />
              <span className="max-w-[150px] truncate text-slate-200 font-mono">{activeModelName || "default"}</span>
              <svg className="w-3 h-3 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showModelMenu && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-30"
                  aria-label="Close model menu"
                  onClick={() => setShowModelMenu(false)}
                />
                <div className="absolute right-0 mt-2 w-80 z-40 bg-slate-800 rounded-xl border border-slate-700 shadow-xl overflow-hidden">
                  <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-700/60">
                    Model for this conversation
                  </div>
                  <button
                    type="button"
                    onClick={() => selectModel(null)}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-slate-700/60 transition-colors flex items-center justify-between gap-2"
                  >
                    <span className="text-slate-300">Profile default</span>
                    {!activeModelName && <span className="text-emerald-400">✓</span>}
                  </button>
                  {configuredModels.map((m) => (
                    <button
                      type="button"
                      key={m.model}
                      onClick={() => selectModel(m.model)}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-slate-700/60 transition-colors cursor-pointer flex flex-col gap-0.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-200 font-mono truncate">{m.model}</span>
                        {activeModelName === m.model && <span className="text-emerald-400 shrink-0">✓</span>}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-slate-500">
                        {m.provider && <span className="truncate">{m.provider}</span>}
                        {m.contextLength && <span className="shrink-0">{fmtTokens(m.contextLength)} ctx</span>}
                      </div>
                    </button>
                  ))}
                  {configuredModels.length === 0 && <div className="px-3 py-2 text-xs text-slate-500">No models detected.</div>}
                </div>
              </>
            )}
          </div>
        )}
      </header>

      {/* Context-size indicator (bar turns amber → red as the chat fills the model window) */}
      {module === "chat" && activeConversationId && activeContextTokens > 0 && (
        <div className="px-4 py-1.5 flex items-center gap-2 border-b border-slate-800 bg-slate-900/70">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 shrink-0">context</span>
          <div className="flex-1 h-1 rounded-full bg-slate-800 overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-300 ${contextBarClass}`} style={{ width: contextWidth }} />
          </div>
          <span className="text-[10px] font-mono text-slate-400 shrink-0">
            {fmtTokens(activeContextTokens)} / {fmtTokens(activeContextWindow)}
          </span>
        </div>
      )}

      {/* Body: left nav rail + active module */}
      <div className="flex flex-1 min-h-0">
        <NavRail active={module} onSelect={setModule} />

        {module === "repos" ? (
          <div className="flex-1 min-h-0">
            <RepoBrowser />
          </div>
        ) : module === "prs" ? (
          <div className="flex-1 min-h-0">
            <PrPanel onClose={() => setModule("chat")} />
          </div>
        ) : module === "deployments" ? (
          <div className="flex-1 min-h-0">
            <Deployments owner="tillmanbuildstech" repo="talaria" project={activeProjectId} />
          </div>
        ) : module === "settings" ? (
          <SettingsPage onClose={() => setModule("chat")} />
        ) : module === "chat" ? (
          <div className="flex-1 min-h-0 flex flex-col">
            {/* Chat area */}
            <div ref={chatContainer} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              {/* Empty state */}
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3">
                  <svg className="w-12 h-12 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                    />
                  </svg>
                  <p className="text-sm">Send a message to start chatting. Open the sidebar to message an agent directly or start a group.</p>
                </div>
              )}

              {messages.map((msg) => (
                <ChatMessage key={msg.id} message={msg} onRetry={() => store.retryMessage(msg.id as number)} />
              ))}

              {/* Auto-scroll anchor */}
              <div ref={scrollAnchor} />
            </div>

            {/* Input */}
            <ChatInput onSend={handleSend} onStop={() => store.stopStreaming()} />
          </div>
        ) : (
          /* Coming-soon modules (command-center, docs, editor) render a placeholder */
          <div className="flex-1 min-h-0 flex items-center justify-center text-slate-500">
            <p className="text-sm">This module is coming soon.</p>
          </div>
        )}
      </div>

      {/* Sidebar overlay */}
      {sidebar.mounted && (
        <Sidebar
          onClose={() => setShowSidebar(false)}
          style={{ transform: sidebar.entered ? "translateX(0)" : "translateX(-100%)" }}
        />
      )}
    </div>
  );
}
