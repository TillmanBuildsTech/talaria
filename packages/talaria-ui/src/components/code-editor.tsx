// M3 code editor module (desktop anchor). A real CodeMirror editor to read and
// edit the code agents produce, saving edits back to a branch. Desktop-only per
// the form-factor decision; rendered behind the capability abstraction so the
// web PWA degrades to a clear "desktop-only" affordance instead of breaking
// (P6). Mounted in both shells from @talaria/ui — only the backend differs.
//
// The CodeMirror pane is lazy-loaded so its (large) bundle only ships to the
// desktop shell; the web surface never downloads it (P6).
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useEditorStore } from "../stores/editor";
import { useReposStore } from "../stores/repos";
import { useProjectsStore } from "../stores/projects";
import { registerEditorBackendForPlatform } from "../services/github-editor-backend";

const EditorPane = lazy(() => import("./editor-pane").then((m) => ({ default: m.EditorPane })));

// A tree of files grouped into a simple file browser (no virtualized tree —
// repos are small enough for a flat list sorted by path).
function FileList({
  files,
  onOpen,
  activePath,
}: {
  files: Array<{ path: string; size?: number }>;
  onOpen: (path: string) => void;
  activePath: string | null;
}) {
  const sorted = useMemo(() => [...files].sort((a, b) => a.path.localeCompare(b.path)), [files]);
  return (
    <ul className="divide-y divide-slate-800/40 text-xs">
      {sorted.length === 0 && <li className="px-3 py-4 text-slate-600 text-center">No files on this branch.</li>}
      {sorted.map((f) => (
        <li key={f.path}>
          <button
            type="button"
            onClick={() => onOpen(f.path)}
            className={`w-full text-left px-3 py-1.5 font-mono truncate transition-colors ${
              activePath === f.path ? "bg-blue-600/15 text-blue-300" : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
            }`}
            title={f.path}
          >
            {f.path}
          </button>
        </li>
      ))}
    </ul>
  );
}

// The desktop-only affordance — shown on web so the module degrades gracefully
// instead of breaking (P6). Never attempts file IO.
function DesktopOnlyAffordance() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center h-full text-slate-500 gap-3 px-6 text-center">
      <svg className="w-10 h-10 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
        />
      </svg>
      <p className="text-sm font-medium text-slate-300">Code editor is desktop-only</p>
      <p className="text-xs text-slate-500 max-w-sm">
        Editing agent-written code runs in the Talaria desktop app, where it has native file/repo access. Open the
        desktop app to view and edit files.
      </p>
    </div>
  );
}

export function CodeEditor() {
  const available = useEditorStore((s) => s.available);
  const refresh = useEditorStore((s) => s.refresh);
  const files = useEditorStore((s) => s.files);
  const doc = useEditorStore((s) => s.doc);
  const content = useEditorStore((s) => s.content);
  const dirty = useEditorStore((s) => s.dirty);
  const loading = useEditorStore((s) => s.loading);
  const saving = useEditorStore((s) => s.saving);
  const error = useEditorStore((s) => s.error);
  const savedMessage = useEditorStore((s) => s.savedMessage);
  const listFiles = useEditorStore((s) => s.listFiles);
  const openFile = useEditorStore((s) => s.openFile);
  const setContent = useEditorStore((s) => s.setContent);
  const save = useEditorStore((s) => s.save);
  const close = useEditorStore((s) => s.close);

  const repos = useReposStore((s) => s.repos);
  const branches = useReposStore((s) => s.branches);
  const loadRepos = useReposStore((s) => s.loadRepos);
  const loadBranches = useReposStore((s) => s.loadBranches);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);

  const [repoId, setRepoId] = useState<string>("");
  const [branch, setBranch] = useState<string>("");

  // On mount: register the desktop backend if we're in Tauri, then reflect
  // availability (web stays unavailable → affordance).
  useEffect(() => {
    registerEditorBackendForPlatform();
    refresh();
  }, [refresh]);

  // Load repos for the editor's picker.
  useEffect(() => {
    if (available && repos.length === 0) loadRepos(activeProjectId);
  }, [available, repos.length, loadRepos, activeProjectId]);

  // When a repo is chosen, load its branches and list files on the default one.
  useEffect(() => {
    if (!available || !repoId) return;
    const repo = repos.find((r) => r.id === repoId);
    if (!repo) return;
    (async () => {
      const branchList = await loadBranches(repo);
      const target = branchList.some((b) => b.name === repo.defaultBranch)
        ? repo.defaultBranch
        : branchList[0]?.name;
      if (target) {
        setBranch(target);
        await listFiles(repo.owner, repo.name, target);
      }
    })();
  }, [repoId, available, repos, loadBranches, listFiles]);

  function selectBranch(b: string) {
    setBranch(b);
    const repo = repos.find((r) => r.id === repoId);
    if (repo) listFiles(repo.owner, repo.name, b);
    close(); // clear any open doc when switching branch context
  }

  function open(path: string) {
    const repo = repos.find((r) => r.id === repoId);
    if (repo && branch) {
      openFile({ owner: repo.owner, repo: repo.name, branch, path });
    }
  }

  // Guard: if the backend is unavailable, render the affordance.
  if (!available) return <DesktopOnlyAffordance />;

  return (
    <div className="flex-1 flex min-h-0">
      {/* File browser + repo/branch picker */}
      <div className="w-72 shrink-0 border-r border-slate-800 flex flex-col min-h-0">
        <div className="px-3 py-2 space-y-2 border-b border-slate-800">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-slate-600 mb-1">Repo</label>
            <select
              value={repoId}
              onChange={(e) => {
                setRepoId(e.target.value);
                close();
              }}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200"
            >
              <option value="">Select a repo…</option>
              {repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.fullName}
                </option>
              ))}
            </select>
          </div>
          {branch && (
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-600 mb-1">Branch</label>
              <select
                value={branch}
                onChange={(e) => selectBranch(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200"
              >
                {(branches[repoId] || []).map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading && files.length === 0 ? (
            <div className="px-3 py-4 text-xs text-slate-500 flex items-center gap-2">
              <span className="w-3 h-3 border-2 border-slate-600 border-t-transparent rounded-full animate-spin" />
              Loading…
            </div>
          ) : (
            <FileList files={files} onOpen={open} activePath={doc?.path ?? null} />
          )}
        </div>
      </div>

      {/* Editor pane */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800 shrink-0">
          <span className="flex-1 min-w-0 font-mono text-xs text-slate-300 truncate">
            {doc ? `${doc.repo}/${doc.path}` : "Select a file to edit"}
          </span>
          {dirty && <span className="text-[10px] text-amber-400 shrink-0">unsaved</span>}
          {savedMessage && <span className="text-[10px] text-emerald-400 shrink-0">{savedMessage}</span>}
          <button
            type="button"
            onClick={() => save()}
            disabled={!doc || !dirty || saving}
            className="shrink-0 text-[11px] px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-blue-600/20 border border-blue-500/40 text-blue-300 hover:bg-blue-600/30"
          >
            {saving ? "Saving…" : "Save to branch"}
          </button>
        </div>
        {error && <p className="text-xs text-amber-400 bg-amber-400/10 border-b border-amber-400/20 px-3 py-2">{error}</p>}
        <div className="flex-1 min-h-0 overflow-hidden">
          {doc ? (
            <Suspense
              fallback={
                <div className="h-full flex items-center justify-center text-xs text-slate-600">Loading editor…</div>
              }
            >
              <EditorPane path={doc.path} value={content} onChange={setContent} />
            </Suspense>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-slate-600">
              Open a file from the left to edit it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
