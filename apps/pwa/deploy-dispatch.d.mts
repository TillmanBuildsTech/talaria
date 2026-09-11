// Type declarations for the shared /api/deployments/dispatch server module
// (the plain .mjs the Vite dev server + serve.mjs both use). Kept minimal and
// co-located so the PWA browser tsconfig can import it type-clean without
// @types/node.
export function declaredDispatchInputs(yamlText: string | null | undefined): string[];
export function buildDispatchInputs(opts: {
  inputs?: Record<string, string>;
  yamlText?: string | null;
  key?: string | null;
  inputName?: string;
}): Record<string, string>;
export function serveDeployDispatch(
  req: unknown,
  res: unknown,
  deps: {
    githubProxy: (arg: {
      method: string;
      path: string;
      body?: unknown;
    }) => Promise<{ ok: boolean; status: number; data?: Record<string, unknown> }>;
    getKey?: () => string | null;
  }
): Promise<void>;
