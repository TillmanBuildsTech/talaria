// Type declarations for the shared per-project docs server module (the plain
// .mjs the Vite dev server + serve.mjs both use). Kept minimal and co-located
// so the PWA browser tsconfig can import it type-clean without @types/node.
export const PROJECTS_DOCS_RE: RegExp;
export function isProjectsDocsPath(pathname: string): boolean;
export function projectsDocsDir(home: string, slug: string): string;
export function resolveDocFile(
  home: string,
  slug: string,
  docPath: string
): string | null;
export function readJsonBody(req: unknown, cap?: number): Promise<Record<string, unknown>>;
export function handleProjectsDocs(
  req: { method: string; pathname: string; body?: Record<string, unknown> },
  home: string
): Promise<{ status: number; body?: unknown } | null>;
export function sendProjectsDocsResult(res: unknown, result: unknown): boolean;
export function projectsDocsHome(env?: Record<string, string | undefined>): string;
