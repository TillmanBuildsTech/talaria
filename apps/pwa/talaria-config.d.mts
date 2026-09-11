// Type declarations for the shared /talaria-config server module (the plain
// .mjs the Vite dev server + serve.mjs both use). Kept minimal and co-located
// so the PWA browser tsconfig can import it type-clean without @types/node.
export function hermesHomeRoot(env?: Record<string, string | undefined>): string;
export function readApiServerKey(envPath: string): string;
export function readProfileModel(profileDir: string): {
  model?: string;
  provider?: string;
  contextLength?: number | null;
};
export function buildTalariaConfig(opts?: {
  home?: string;
  env?: Record<string, string | undefined>;
}): {
  base: string;
  agents: Record<string, string>;
  models: Record<string, { model: string; provider: string; contextLength: number | null }>;
  modelProviders: string[];
};
export function modelProvidersAvailable(home?: string): string[];
export function serveTalariaConfig(res: unknown, opts?: unknown): void;
