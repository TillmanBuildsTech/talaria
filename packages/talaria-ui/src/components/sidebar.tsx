import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Agent, Conversation } from "../db";
import { useChatStore } from "../stores/chat";
import { AgentAvatar } from "./agent-avatar";
import { ConversationBadge } from "./conversation-badge";

type Picking = null | "dm" | "group";

type SidebarProps = {
  onClose: () => void;
  style?: CSSProperties;
};

export function Sidebar({ onClose, style }: SidebarProps) {
  const agents = useChatStore((s) => s.agents);
  const sidebarConversations = useChatStore(useShallow((s) => s.sidebarConversations()));
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const convTitle = useChatStore((s) => s.convTitle);
  const newConversation = useChatStore((s) => s.newConversation);
  const newDirectMessage = useChatStore((s) => s.newDirectMessage);
  const newGroupConversation = useChatStore((s) => s.newGroupConversation);
  const switchConversation = useChatStore((s) => s.switchConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);

  const [picking, setPicking] = useState<Picking>(null);
  const [selected, setSelected] = useState<Array<string>>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const titleInputs = useRef(new Map<number, HTMLInputElement>());

  useEffect(() => {
    if (editingId == null) return;
    const el = titleInputs.current.get(editingId);
    el?.focus();
    el?.select();
  }, [editingId]);

  function toggleAgent(agent: Agent) {
    if (picking === "dm") {
      setSelected([agent.name]);
      direct(agent.name);
      return;
    }
    setSelected((cur) => (cur.includes(agent.name) ? cur.filter((n) => n !== agent.name) : [...cur, agent.name]));
  }

  function direct(name: string) {
    newDirectMessage(name);
    setSelected([]);
    setPicking(null);
    onClose();
  }

  function startGroup() {
    if (selected.length < 2) return;
    newGroupConversation(selected);
    setSelected([]);
    setPicking(null);
    onClose();
  }

  function select(id: number) {
    switchConversation(id);
    onClose();
  }

  function startEdit(conv: Conversation) {
    setEditingId(conv.id as number);
    setEditTitle(convTitle(conv));
  }

  function saveTitle(id: number) {
    if (editingId === null) return;
    renameConversation(id, editTitle);
    setEditingId(null);
  }

  return (
    <div className="fixed inset-0 z-30 flex transition-transform duration-[250ms] ease" style={style}>
      {/* Backdrop */}
      <button type="button" className="absolute inset-0 bg-black/50" aria-label="Close sidebar" onClick={onClose} />

      {/* Sidebar panel */}
      <div className="relative w-80 max-w-[85vw] h-full bg-slate-950 border-r border-slate-800 flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 shrink-0">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            {picking ? (picking === "group" ? "New group chat" : "Direct message") : "Chat"}
          </h2>
          <div className="flex items-center gap-1">
            {picking && (
              <button
                type="button"
                onClick={() => setPicking(null)}
                className="p-1.5 rounded-lg hover:bg-slate-800 transition-colors text-slate-400"
                aria-label="Back"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={() => newConversation()}
              className="p-1.5 rounded-lg hover:bg-slate-800 transition-colors text-blue-400"
              aria-label="New chat"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        </div>

        {picking ? (
          /* Agent picker (DM / group) */
          <div className="flex-1 overflow-y-auto py-1">
            <p className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {picking === "group" ? "Select agents" : "Choose an agent"}
            </p>
            {agents.map((agent) => (
              <button
                type="button"
                key={agent.name}
                onClick={() => toggleAgent(agent)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-800/50 transition-colors"
              >
                {/* Checkbox (group) / radio dot (DM) */}
                {picking === "group" ? (
                  <span
                    className={`w-5 h-5 shrink-0 rounded border flex items-center justify-center text-xs ${
                      selected.includes(agent.name) ? "bg-blue-600 border-blue-600 text-white" : "border-slate-600 text-transparent"
                    }`}
                  >
                    ✓
                  </span>
                ) : (
                  <span
                    className={`w-5 h-5 shrink-0 rounded-full border-2 ${selected.includes(agent.name) ? "border-blue-500" : "border-slate-600"}`}
                  />
                )}
                <AgentAvatar name={agent.name} display={agent.displayName} color={agent.color} size={10} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-slate-200 truncate">{agent.displayName}</span>
                  <span className="block text-xs text-slate-500 truncate">{agent.description || agent.name}</span>
                </span>
              </button>
            ))}

            {picking === "group" && (
              <div className="px-4 py-3">
                <button
                  type="button"
                  onClick={startGroup}
                  disabled={selected.length < 2}
                  className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    selected.length >= 2 ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-slate-800 text-slate-500 cursor-not-allowed"
                  }`}
                >
                  {selected.length >= 2 ? `Start group (${selected.length})` : "Select at least 2 agents"}
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Agents (contacts) for instant DM */}
            <div className="border-b border-slate-800">
              <div className="flex items-center justify-between px-4 pt-3 pb-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Agents</p>
                <button type="button" onClick={() => setPicking("dm")} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
                  New DM
                </button>
              </div>
              <div className="px-2 pb-2 flex flex-wrap gap-1.5">
                {agents.map((agent) => (
                  <button
                    type="button"
                    key={agent.name}
                    onClick={() => direct(agent.name)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs transition-colors"
                    style={{ backgroundColor: `${agent.color}22`, color: agent.color }}
                    title={`Message ${agent.displayName}`}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: agent.color }} />
                    {agent.displayName}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setPicking("group")}
                className="w-full text-left px-4 py-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-colors"
              >
                ＋ New group chat
              </button>
            </div>

            {/* Conversation list */}
            <div className="flex-1 overflow-y-auto py-1">
              {sidebarConversations.map((conv) => (
                <button
                  type="button"
                  key={conv.id}
                  onClick={() => select(conv.id as number)}
                  className={`w-full text-left px-4 py-3 hover:bg-slate-800/50 transition-colors border-l-2 cursor-pointer group ${
                    conv.id === activeConversationId ? "border-blue-500 bg-slate-800/70" : "border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <ConversationBadge conv={conv} />
                    {/* Inline title edit */}
                    {editingId === conv.id ? (
                      <input
                        value={editTitle}
                        ref={(el) => {
                          if (el) titleInputs.current.set(conv.id as number, el);
                          else titleInputs.current.delete(conv.id as number);
                        }}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            saveTitle(conv.id as number);
                          } else if (e.key === "Escape") {
                            setEditingId(null);
                          }
                        }}
                        onBlur={() => saveTitle(conv.id as number)}
                        className="flex-1 bg-slate-900 text-sm font-medium rounded px-1.5 py-0.5 outline-none ring-1 ring-blue-500 text-slate-100"
                      />
                    ) : (
                      <span className="text-sm font-medium truncate text-slate-200 flex-1">{convTitle(conv)}</span>
                    )}
                    {editingId !== conv.id && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(conv);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-slate-200 transition-opacity shrink-0"
                        aria-label="Rename"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 truncate mt-0.5 pl-10">{conv.lastMessage || "No messages yet"}</div>
                </button>
              ))}

              {sidebarConversations.length === 0 && (
                <div className="px-4 py-8 text-center text-slate-600 text-sm">No conversations yet</div>
              )}
            </div>
          </>
        )}

        {/* Footer */}
        <div className="px-4 py-3 border-t border-slate-800 text-xs text-slate-600">
          Talaria — tap an agent to message it directly
        </div>
      </div>
    </div>
  );
}
