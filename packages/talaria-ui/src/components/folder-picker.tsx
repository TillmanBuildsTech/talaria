// FolderPicker — browse the host filesystem to pick a project's folder
// (project ↔ folder tie, P9). Renders a directory tree from the host (desktop
// via the native fs adapter; web via the gateway). Each subdirectory reports
// whether it is a git repo root so the picker can show the folder's nature.
// Selecting a folder returns its path and git status to the caller.
//
// The transport is the same one the docs module uses (services/docs.ts), so
// both shells reach the SAME host directory (P6).
import { useEffect, useMemo, useState } from "react";
import { docsClient, HOST_DIR_BASE, normalizeHostDir, type HostDirEntry, type HostDirListing } from "../services/docs";

export type PickedFolder = {
  path: string;
  isGitRepo: boolean;
};

type FolderPickerProps = {
  initialPath?: string;
  onPick: (folder: PickedFolder) => void;
};

// A "breadcrumb" path segment for navigation within the picker.
function joinDir(parent: string, name: string): string {
  if (!parent) return name;
  return `${parent}/${name}`;
}

function parentDir(path: string): string | null {
  const idx = path.lastIndexOf("/");
  if (idx <= 0) return null;
  return path.slice(0, idx);
}

export function FolderPicker({ initialPath, onPick }: FolderPickerProps) {
  const [cwd, setCwd] = useState<string>(initialPath || HOST_DIR_BASE);
  const [listing, setListing] = useState<HostDirListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirs = useMemo(
    () => (listing ? listing.entries.filter((e) => e.isDir) : []),
    [listing]
  );

  async function browse(path: string) {
    const safe = normalizeHostDir(path);
    if (!safe) {
      setError("Invalid path.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await docsClient.listDirectory(safe);
      setListing(result);
      setCwd(result.path || safe);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not list directory");
      setListing(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    browse(initialPath || HOST_DIR_BASE);
    // biome-ignore lint/correctness/useExhaustiveDependencies: browse once on mount
  }, []);

  const gitEntry: HostDirEntry | undefined = listing?.entries.find((e) => e.name === ".git");
  const isCurrentGit = !!gitEntry;

  function selectCurrent() {
    onPick({ path: cwd, isGitRepo: isCurrentGit });
  }

  const parent = parentDir(cwd);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-slate-800/60 text-[11px] text-slate-500">
        <span className="font-mono truncate flex-1">{cwd}</span>
        {isCurrentGit && (
          <span className="shrink-0 text-emerald-400" title="This folder is a git repository">
            git ✓
          </span>
        )}
      </div>

      <div className="max-h-48 overflow-y-auto py-1">
        {loading && (
          <div className="px-3 py-2 text-xs text-slate-500">Loading directory…</div>
        )}
        {error && <div className="px-3 py-2 text-xs text-amber-400">{error}</div>}
        {!loading && !error && (
          <>
            {parent && (
              <button
                type="button"
                onClick={() => browse(parent)}
                className="w-full text-left px-3 py-1 text-xs text-slate-400 hover:bg-slate-800/60 transition-colors"
              >
                ↑ ../{parent.split("/").pop()}
              </button>
            )}
            {dirs.length === 0 && (
              <div className="px-3 py-2 text-xs text-slate-600">No subdirectories.</div>
            )}
            {dirs.map((d) => (
              <button
                type="button"
                key={d.name}
                onClick={() => browse(joinDir(cwd, d.name))}
                className="w-full text-left px-3 py-1 text-xs hover:bg-slate-800/60 transition-colors flex items-center gap-2"
              >
                <svg className="w-3 h-3 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <span className="font-mono truncate text-slate-300">{d.name}</span>
                {d.isGitRepo && (
                  <span className="ml-auto shrink-0 text-emerald-400" title="git repository">
                    git
                  </span>
                )}
              </button>
            ))}
          </>
        )}
      </div>

      <div className="px-2 py-1.5 border-t border-slate-800/60 flex items-center justify-end">
        <button
          type="button"
          onClick={selectCurrent}
          disabled={loading || !!error}
          className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Select this folder
        </button>
      </div>
    </div>
  );
}
