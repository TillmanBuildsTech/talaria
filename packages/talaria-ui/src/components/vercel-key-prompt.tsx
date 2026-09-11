// VercelKeyPrompt — inline gate for the Deployments trigger flow.
//
// Deployments need a default Vercel API key before a workflow_dispatch can
// fire (the server stores it encrypted at rest; the browser never sees it).
// When no key is configured the UI shows this prompt instead of dispatching;
// on submit the key is saved via PUT /api/deployments/vercel-key and the
// caller continues its pending action (this task's acceptance criteria).
//
// Self-contained + controlled: the parent decides when to show it (keyPromptOpen)
// and owns the save/cancel handlers so the whole gate flow stays testable.
import { useState } from "react";

export type VercelKeyPromptProps = {
  // True when prompting to UPDATE an existing key vs. first-time setup.
  updating: boolean;
  busy: boolean;
  error: string | null;
  onSave: (apiKey: string) => void;
  onCancel: () => void;
};

export function VercelKeyPrompt({ updating, busy, error, onSave, onCancel }: VercelKeyPromptProps) {
  const [value, setValue] = useState("");

  function submit() {
    if (busy || !value.trim()) return;
    onSave(value.trim());
  }

  return (
    <div
      role="dialog"
      aria-label="Vercel API key"
      className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 space-y-2"
    >
      <div className="text-xs font-medium uppercase tracking-wide text-blue-300">
        {updating ? "Update Vercel API key" : "Vercel API key required"}
      </div>
      <p className="text-xs text-slate-300">
        {updating
          ? "Replace the saved default Vercel API key used to trigger deployments."
          : "A default Vercel API key is required before a deployment can be triggered. Paste one below — it is stored encrypted on your server and never sent back to this page."}
      </p>
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !busy && value.trim()) submit();
        }}
        placeholder="Paste Vercel API key"
        autoFocus
        className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:ring-1 focus:ring-blue-500"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy || !value.trim()}
          onClick={submit}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
        >
          {busy ? "Saving…" : updating ? "Save key" : "Save & continue"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
