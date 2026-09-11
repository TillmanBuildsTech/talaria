// Vercel API-key client — the browser-facing half of the shared
// /api/deployments/vercel-key store (server module: apps/pwa/vercel-key.mjs).
//
// The raw key NEVER reaches the browser. The server keeps it AES-256-GCM
// encrypted at rest and only ever answers two questions:
//
//   GET /api/deployments/vercel-key            -> { configured: true|false }
//   PUT /api/deployments/vercel-key { apiKey } -> { configured: true }
//
// This client exposes exactly those two operations to the Deployments UI so it
// can gate "trigger deployment" behind "a default Vercel API key is stored".
// It is same-origin (serve.mjs + the Vite dev middleware both serve it).
//
// Auth: GET needs nothing (it only returns `configured`). PUT overwrites a
// stored credential, so the server requires the SAME gateway Bearer key the
// app already uses for every other /api request — pass `authKey` (the base
// Hermes API key the app was provisioned with) so the write is authorized.

// Shape of the GET response. The server only ever reports `configured` —
// the key itself is never transmitted to the browser.
export type VercelKeyStatus = {
  configured: boolean;
};

// Endpoint served on every path the app actually uses (serve.mjs + Vite dev).
const VERCEL_KEY_URL = "/api/deployments/vercel-key";

// GET — returns only whether a default key is configured, never the key.
export async function getVercelKeyConfigured(
  fetchImpl: typeof fetch = fetch.bind(globalThis as typeof globalThis & Window)
): Promise<boolean> {
  const res = await fetchImpl(VERCEL_KEY_URL, { method: "GET" });
  if (!res.ok) {
    throw new Error(`Could not check Vercel API key status (HTTP ${res.status})`);
  }
  const data = (await res.json().catch(() => ({}))) as VercelKeyStatus;
  return data?.configured === true;
}

// PUT — store the pasted key as the default. The response never echoes it.
// `authKey` is the gateway Bearer key (base Hermes API key) that authorizes
// the write — same auth model as the rest of /api.
export async function saveVercelApiKey(
  apiKey: string,
  authKey: string | null | undefined,
  fetchImpl: typeof fetch = fetch.bind(globalThis as typeof globalThis & Window)
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authKey) headers.Authorization = `Bearer ${authKey}`;
  const res = await fetchImpl(VERCEL_KEY_URL, {
    method: "PUT",
    headers,
    body: JSON.stringify({ apiKey }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: string };
      detail = body?.error ? `: ${body.error}` : "";
    } catch {
      /* non-JSON error body — fall back to status */
    }
    throw new Error(`Could not save Vercel API key (HTTP ${res.status})${detail}`);
  }
}

// ── Server-side deployment dispatch ─────────────────────────────────────────
//
// The Deployments trigger is dispatched server-side (POST /api/deployments/
// dispatch) so the stored Vercel API key can be injected into the workflow
// inputs WITHOUT ever reaching the browser. The server reads the key, adds it
// as `vercel_token` only when the target workflow declares that input, and
// forwards the workflow_dispatch to GitHub via the gateway proxy.
//
// This client just relays the dispatch params + the gateway API key (which the
// server forwards to the gateway proxy so the GitHub token attaches). The raw
// Vercel key is never sent by the browser.

export type DispatchDeploymentParams = {
  owner: string;
  repo: string;
  workflowId: number;
  ref: string;
  inputs?: Record<string, string>;
};

const DISPATCH_URL = "/api/deployments/dispatch";

// POST — dispatch a workflow_dispatch through the server so the stored Vercel
// key is injected server-side. `apiKey` is the gateway API key (the same Bearer
// the browser sends for gateway GitHub proxy calls) — serve.mjs forwards it so
// the gateway attaches the GitHub token. Throws on any GitHub error.
export async function dispatchDeploymentViaServer(
  params: DispatchDeploymentParams,
  apiKey: string | null,
  fetchImpl: typeof fetch = fetch.bind(globalThis as typeof globalThis & Window)
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetchImpl(DISPATCH_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(params),
  });
  if (res.ok) return; // 204
  let detail = "";
  try {
    const body = (await res.json()) as { error?: string };
    detail = body?.error ? `: ${body.error}` : "";
  } catch {
    /* non-JSON error body — fall back to status */
  }
  throw new Error(`Dispatch failed (HTTP ${res.status})${detail}`);
}
