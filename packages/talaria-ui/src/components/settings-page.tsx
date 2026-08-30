import { useState } from "react";
import db from "../db";
import type { Agent } from "../db";
import { useChatStore } from "../stores/chat";
import { AgentAvatar } from "./agent-avatar";
import { GitHubConnect } from "./github-connect";

type SettingsPageProps = {
  onClose: () => void;
};

const PRESETS = [
  { label: "Local (Vite proxy)", url: "/api/v1", short: "/api/v1" },
  { label: "Local direct", url: "http://localhost:8642/api/v1", short: ":8642" },
  { label: "Cloudflare Tunnel", url: "https://hermes.yourdomain.com/api/v1", short: "CF" },
  { label: "Tailscale", url: "http://100.x.x.x:8642/api/v1", short: "TS" },
];

export function SettingsPage({ onClose }: SettingsPageProps) {
  const baseUrl = useChatStore((s) => s.baseUrl);
  const apiKey = useChatStore((s) => s.apiKey);
  const agents = useChatStore((s) => s.agents);
  const setBaseUrl = useChatStore((s) => s.setBaseUrl);
  const setApiKey = useChatStore((s) => s.setApiKey);
  const addAgent = useChatStore((s) => s.addAgent);
  const removeAgent = useChatStore((s) => s.removeAgent);
  const resetAll = useChatStore((s) => s.resetAll);

  const [urlInput, setUrlInput] = useState(baseUrl);
  const [keyInput, setKeyInput] = useState(apiKey);
  const [addingAgent, setAddingAgent] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [formName, setFormName] = useState("");
  const [formDisplay, setFormDisplay] = useState("");
  const [formApiKey, setFormApiKey] = useState("");

  function saveAll() {
    setBaseUrl(urlInput);
    setApiKey(keyInput);
    onClose();
  }

  function beginAdd() {
    setEditingAgent(null);
    setFormName("");
    setFormDisplay("");
    setFormApiKey("");
    setAddingAgent((v) => !v);
  }

  function beginEdit(agent: Agent) {
    setEditingAgent(agent);
    setFormName(agent.name);
    setFormDisplay(agent.displayName || "");
    setFormApiKey(agent.apiKey || "");
    setAddingAgent(true);
  }

  async function saveAgent() {
    const name = formName.trim();
    if (!name) return;
    await addAgent({
      name,
      displayName: formDisplay.trim(),
      apiKey: formApiKey.trim(),
    });
    setEditingAgent(null);
    setFormName("");
    setFormDisplay("");
    setFormApiKey("");
    setAddingAgent(false);
  }

  async function clearAll() {
    if (!confirm("Delete all conversations and messages? This cannot be undone.")) return;
    await db.messages.clear();
    await db.conversations.clear();
    resetAll();
    onClose();
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
      {/* Page header */}
      <header className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur px-5 py-4 border-b border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-800 transition-colors"
            aria-label="Back"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-base font-semibold">Settings</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
          aria-label="Close settings"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </header>

      <div className="px-5 py-4 space-y-5 max-w-2xl w-full mx-auto">
        {/* API Key (optional for local gateway) */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5" htmlFor="settings-api-key">
            API Key
          </label>
          <input
            id="settings-api-key"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            type="password"
            onKeyDown={(e) => e.key === "Enter" && saveAll()}
            className="w-full bg-slate-800 text-sm rounded-lg px-3 py-2.5 border-none outline-none
                 focus:ring-2 focus:ring-blue-500/50 text-slate-100 placeholder-slate-600"
            placeholder="Required for gateway authentication"
          />
          <p className="text-xs text-slate-600 mt-1">Hermes Gateway API Server key</p>
        </div>

        {/* Connection URL */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5" htmlFor="settings-api-url">
            Hermes API URL
          </label>
          <input
            id="settings-api-url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveAll()}
            className="w-full bg-slate-800 text-sm rounded-lg px-3 py-2.5 border-none outline-none
                 focus:ring-2 focus:ring-blue-500/50 text-slate-100 placeholder-slate-600"
            placeholder="http://localhost:8642/api/v1"
          />
          <p className="text-xs text-slate-600 mt-1">
            Use <code className="text-slate-500">/api/v1</code> for local dev, or full URL for remote
          </p>
        </div>

        <button type="button" onClick={saveAll} className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-sm font-medium transition-colors">
          Save &amp; Reconnect
        </button>

        {/* Presets */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-slate-500">Quick connect</p>
          {PRESETS.map((preset) => (
            <button
              type="button"
              key={preset.label}
              onClick={() => setUrlInput(preset.url)}
              className="w-full text-left px-3 py-2 rounded-lg text-sm text-slate-400
                  hover:bg-slate-800 hover:text-slate-200 transition-colors
                  flex items-center justify-between"
            >
              <span>{preset.label}</span>
              <span className="text-xs text-slate-600 font-mono">{preset.short}</span>
            </button>
          ))}
        </div>

        {/* GitHub connection (M2 auth — device flow + PAT fallback) */}
        <GitHubConnect />

        {/* Agents (profile contacts) */}
        <div className="pt-1">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-medium text-slate-500">Agents (Hermes profiles)</p>
            <button type="button" onClick={beginAdd} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
              {editingAgent || addingAgent ? "Cancel" : "+ Add"}
            </button>
          </div>

          {/* Add / edit agent form */}
          {addingAgent && (
            <div className="space-y-2 mb-2 bg-slate-800/50 rounded-lg p-3">
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                disabled={!!editingAgent}
                placeholder="Profile name (e.g. developer)"
                className="w-full bg-slate-800 text-sm rounded-lg px-3 py-2 border-none outline-none
                    focus:ring-2 focus:ring-blue-500/50 text-slate-100 placeholder-slate-600 disabled:opacity-50"
              />
              <input
                value={formDisplay}
                onChange={(e) => setFormDisplay(e.target.value)}
                placeholder="Display name (optional)"
                className="w-full bg-slate-800 text-sm rounded-lg px-3 py-2 border-none outline-none
                    focus:ring-2 focus:ring-blue-500/50 text-slate-100 placeholder-slate-600"
              />
              <input
                value={formApiKey}
                onChange={(e) => setFormApiKey(e.target.value)}
                type="password"
                placeholder="API key (auto-filled from global if empty)"
                className="w-full bg-slate-800 text-sm rounded-lg px-3 py-2 border-none outline-none
                    focus:ring-2 focus:ring-blue-500/50 text-slate-100 placeholder-slate-600"
              />
              <button
                type="button"
                onClick={saveAgent}
                disabled={!formName.trim()}
                className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
                  formName.trim() ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-slate-800 text-slate-500 cursor-not-allowed"
                }`}
              >
                {editingAgent ? "Save agent" : "Add agent"}
              </button>
              <p className="text-[11px] text-slate-600">
                Each Hermes profile has its own API key. Requires <code className="text-slate-500">gateway.multiplex_profiles</code> on the
                gateway.
              </p>
            </div>
          )}

          <ul className="divide-y divide-slate-800/60">
            {agents.map((agent) => (
              <li key={agent.name} className="flex items-center gap-3 py-2">
                <AgentAvatar name={agent.name} display={agent.displayName} color={agent.color} size={9} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-slate-200 truncate">{agent.displayName}</span>
                  <span className="block text-xs text-slate-500 font-mono truncate">{agent.name}</span>
                </span>
                <button type="button" onClick={() => beginEdit(agent)} className="text-xs text-slate-400 hover:text-slate-200 transition-colors shrink-0">
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => removeAgent(agent.name)}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors shrink-0"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Danger zone */}
        <div className="pt-3 border-t border-slate-800">
          <button
            type="button"
            onClick={clearAll}
            className="w-full py-2.5 rounded-lg border border-red-500/30 text-red-400
                text-sm font-medium hover:bg-red-500/10 transition-colors"
          >
            Clear All Data
          </button>
        </div>
      </div>
    </div>
  );
}
