import type { ReactNode } from "react";

// Left-hand navigation rail for the Developer Portal (P4 — one pane of glass).
// Gives every module a labeled entry so nothing is orphaned behind an unlabeled
// header icon. Modules that are "coming soon" (not yet merged / desktop-only)
// render disabled with a note. Both shells mount this via the shared App (P6).
export type NavModuleId =
  | "chat"
  | "command-center"
  | "repos"
  | "prs"
  | "deployments"
  | "docs"
  | "editor";

export type NavEntry = {
  id: NavModuleId;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  note?: string;
};

const baseIcon =
  "w-5 h-5 shrink-0";

function ChatIcon() {
  return (
    <svg className={baseIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
    </svg>
  );
}

function BoardIcon() {
  return (
    <svg className={baseIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h7v7H3V3zm11 0h7v7h-7V3zM3 14h7v7H3v-7zm11 0h7v7h-7v-7z" />
    </svg>
  );
}

function RepoIcon() {
  return (
    <svg className={baseIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

function PrIcon() {
  return (
    <svg className={baseIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 15a3 3 0 100-6 3 3 0 000 6zm12 0a3 3 0 100-6 3 3 0 000 6zM6 15v2a3 3 0 003 3h6" />
    </svg>
  );
}

function DeployIcon() {
  return (
    <svg className={baseIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg className={baseIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function EditorIcon() {
  return (
    <svg className={baseIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  );
}

const DEFAULT_ENTRIES: Array<NavEntry> = [
  { id: "chat", label: "Chat", icon: <ChatIcon /> },
  { id: "command-center", label: "Command Center", icon: <BoardIcon />, disabled: true, note: "coming soon" },
  { id: "repos", label: "Repos", icon: <RepoIcon /> },
  { id: "prs", label: "Pull Requests", icon: <PrIcon /> },
  { id: "deployments", label: "Deployments", icon: <DeployIcon /> },
  { id: "docs", label: "Docs", icon: <DocIcon />, disabled: true, note: "coming soon" },
  { id: "editor", label: "Editor", icon: <EditorIcon />, disabled: true, note: "desktop only" },
];

export function NavRail({
  active,
  onSelect,
  entries = DEFAULT_ENTRIES,
}: {
  active: NavModuleId;
  onSelect: (id: NavModuleId) => void;
  entries?: Array<NavEntry>;
}) {
  return (
    <nav
      aria-label="Modules"
      className="w-16 shrink-0 border-r border-slate-800 bg-slate-900/60 flex flex-col items-center py-2 gap-1"
    >
      {entries.map((entry) => {
        const isActive = active === entry.id;
        const disabled = entry.disabled;
        return (
          <button
            key={entry.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(entry.id)}
            title={entry.note ? `${entry.label} — ${entry.note}` : entry.label}
            aria-label={entry.label}
            aria-current={isActive ? "page" : undefined}
            className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors ${
              disabled
                ? "text-slate-600 cursor-not-allowed"
                : isActive
                  ? "bg-slate-700 text-slate-100"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            {entry.icon}
            <span className="text-[9px] leading-none tracking-wide">{entry.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
