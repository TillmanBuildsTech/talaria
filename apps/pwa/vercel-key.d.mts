// Type declarations for the shared /api/deployments/vercel-key server module
// (the plain .mjs the Vite dev server + serve.mjs both use). Kept minimal and
// co-located so the PWA browser tsconfig can import it type-clean without
// @types/node.
export function hermesHomeRoot(env?: Record<string, string | undefined>): string;
export function encryptSecret(
  key: Buffer,
  plaintext: string
): { iv: string; authTag: string; data: string };
export function decryptSecret(
  key: Buffer,
  bundle: { iv: string; authTag: string; data: string }
): string;
export function setVercelApiKey(
  apiKey: string,
  opts?: { home?: string; env?: Record<string, string | undefined> }
): { configured: true };
export function getVercelApiKey(opts?: {
  home?: string;
  env?: Record<string, string | undefined>;
}): string | null;
export function validateVercelApiKey(value: unknown): string | null;
export function vercelKeyConfigured(opts?: {
  home?: string;
  env?: Record<string, string | undefined>;
}): boolean;
export function vercelKeyWriteAuthorized(
  req: { headers?: Record<string, string | undefined> },
  opts?: { home?: string; env?: Record<string, string | undefined> }
): boolean;
export function serveVercelKey(
  req: unknown,
  res: unknown,
  opts?: { home?: string; env?: Record<string, string | undefined> }
): Promise<void>;
