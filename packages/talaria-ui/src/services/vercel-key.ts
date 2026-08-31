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
// It is same-origin (serve.mjs + the Vite dev middleware both serve it), so no
// gateway auth header is needed — mirroring the /talaria-config fetch pattern.

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
export async function saveVercelApiKey(
  apiKey: string,
  fetchImpl: typeof fetch = fetch.bind(globalThis as typeof globalThis & Window)
): Promise<void> {
  const res = await fetchImpl(VERCEL_KEY_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
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
