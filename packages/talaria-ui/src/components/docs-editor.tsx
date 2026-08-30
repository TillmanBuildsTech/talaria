// Docs editor module (M1 item 3) — read/write markdown project documentation.
//
// A Docs section per project (projects.md): markdown files written and edited
// inside Talaria with a built-in editor. Stored on the Hermes server (P10) at
// ~/.hermes/projects/<slug>/docs/*.md — OUTSIDE the repo — and distinct from
// the product's own apps/docs.
//
// Scoped to the active project (P9): switching projects swaps the doc set.
// The global/unassigned scope has no docs directory, so it shows a prompt to
// pick a project. Mounted from the shared App so both shells (PWA + desktop)
// render it (P6).
import { useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useProjectsStore } from "../stores/projects";
import { useDocsStore } from "../stores/docs";
import { normalizeDocName } from "../services/docs";

marked.setOptions({ gfm: true, breaks: true });

// A tiny inline markdown renderer for the read (preview) pane. Sanitized via
// DOMPurify before render (same pattern as chat-message).
function MarkdownPreview({ content }: { content: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(content || "") as string),
    [content]
  );
  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized via DOMPurify before render
    <div className="markdown prose prose-invert prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

export function DocsEditor() {
  const activeProject = useProjectsStore((s) => s.activeProject());
  const docs = useDocsStore((s) => s.docs);
  const activeDoc = useDocsStore((s) => s.activeDoc);
  const draft = useDocsStore((s) => s.draft);
  const loading = useDocsStore((s) => s.loading);
  const saving = useDocsStore((s) => s.saving);
  const error = useDocsStore((s) => s.error);
  const loadForProject = useDocsStore((s) => s.loadForProject);
  const openDoc = useDocsStore((s) => s.openDoc);
  const setDraft = useDocsStore((s) => s.setDraft);
  const save = useDocsStore((s) => s.save);
  const createDoc = useDocsStore((s) => s.createDoc);
  const deleteDoc = useDocsStore((s) => s.deleteDoc);

  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [creating, setCreating] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const projectSlug = activeProject?.slug ?? null;

  // Load the active project's docs on scope switch (P9).
  useEffect(() => {
    if (projectSlug) {
      loadForProject(projectSlug);
    } else {
      useDocsStore.getState().reset();
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: reload on scope change
  }, [projectSlug]);

  function open(path: string) {
    if (projectSlug) openDoc(projectSlug, path);
  }

  async function submitCreate() {
    const name = normalizeDocName(nameDraft);
    if (!name || !projectSlug) return;
    await createDoc(projectSlug, name);
    setNameDraft("");
    setCreating(false);
    await openDoc(projectSlug, name);
  }

  async function handleDelete(path: string) {
    if (!projectSlug) return;
    // Safe default: confirm before destroying a doc.
    // biome-ignore lint/suspicious/noConfusingVoidType: explicit guard
    if (!window.confirm(`Delete "${path}"? This cannot be undone.`)) return;
    await deleteDoc(projectSlug, path);
  }

  const dirty = activeDoc ? draft !== activeDoc.content : false;

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <h2 className="text-sm font-semibold text-slate-300">Project Docs</h2>
        <span className="text-[10px] uppercase tracking-wider text-slate-500">
          {activeProject ? `scope · ${activeProject.name}` : "scope · Global / Unassigned"}
        </span>
      </div>

      {error && (
        <p className="mx-4 mt-3 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Doc list */}
        <aside className="w-56 shrink-0 border-r border-slate-800 overflow-y-auto flex flex-col">
          <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800/60">
            {docs.length} doc{docs.length === 1 ? "" : "s"}
          </div>
          {docs.map((d) => (
            <button
              key={d.path}
              type="button"
              onClick={() => open(d.path)}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-800/60 transition-colors flex items-center gap-1.5 group ${
                activeDoc?.path === d.path ? "bg-slate-800/80 text-slate-100" : "text-slate-400"
              }`}
            >
              <svg className="w-3.5 h-3.5 shrink-0 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="truncate flex-1">{d.name}</span>
              <span
                role="button"
                tabIndex={0}
                aria-label={`Delete ${d.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(d.path);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    handleDelete(d.path);
                  }
                }}
                className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 transition-opacity"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </span>
            </button>
          ))}

          {creating ? (
            <div className="px-3 py-2 border-t border-slate-800/60 flex items-center gap-2">
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitCreate();
                  } else if (e.key === "Escape") {
                    setCreating(false);
                  }
                }}
                placeholder="doc-name.md"
                className="flex-1 bg-slate-900 text-xs rounded px-2 py-1.5 outline-none ring-1 ring-blue-500 text-slate-100"
              />
              <button
                type="button"
                onClick={submitCreate}
                disabled={!nameDraft.trim()}
                className={`px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                  nameDraft.trim() ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-slate-700 text-slate-400 cursor-not-allowed"
                }`}
              >
                Create
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={!projectSlug}
              onClick={() => setCreating(true)}
              className="w-full text-left px-3 py-2 text-xs text-blue-400 hover:bg-slate-800/60 transition-colors border-t border-slate-800/60 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ＋ New doc
            </button>
          )}
        </aside>

        {/* Editor / preview */}
        <section className="flex-1 flex flex-col min-w-0">
          {!projectSlug ? (
            <div className="flex-1 flex items-center justify-center text-xs text-slate-500">
              Docs live per project — pick a project scope to see its documentation.
            </div>
          ) : activeDoc ? (
            <>
              {/* Toolbar */}
              <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800/60">
                <span className="text-xs font-mono text-slate-300 truncate flex-1">{activeDoc.name}</span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setMode("edit")}
                    className={`px-2.5 py-1 text-[11px] rounded-lg transition-colors ${
                      mode === "edit" ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:bg-slate-800"
                    }`}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("preview")}
                    className={`px-2.5 py-1 text-[11px] rounded-lg transition-colors ${
                      mode === "preview" ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:bg-slate-800"
                    }`}
                  >
                    Preview
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => save(projectSlug)}
                  disabled={saving || !dirty}
                  className={`px-2.5 py-1 text-[11px] rounded-lg transition-colors ${
                    saving || !dirty
                      ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                      : "bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/30"
                  }`}
                >
                  {saving ? "Saving…" : dirty ? "Save" : "Saved"}
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-4 py-3">
                {mode === "edit" ? (
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    spellCheck={false}
                    className="w-full h-full min-h-[300px] bg-slate-950/60 text-sm font-mono text-slate-200 rounded-lg p-3 border border-slate-800 outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                    placeholder="# Write your project's design, ADRs, meeting notes…"
                  />
                ) : (
                  <MarkdownPreview content={draft} />
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-slate-500">
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-slate-600 border-t-transparent rounded-full animate-spin" />
                  Loading docs…
                </span>
              ) : (
                "Select a doc to edit, or create a new one."
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
