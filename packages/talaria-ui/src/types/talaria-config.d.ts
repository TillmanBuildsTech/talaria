// Ambient types for the shared /talaria-config server module and the node
// builtins its unit test touches. The PWA tsconfig deliberately targets the
// browser (lib DOM, no @types/node), so node:fs/os/path and the plain .mjs
// import are untyped here. These loose declarations keep the config-module
// test type-clean WITHOUT pulling @types/node into the global project (which
// would risk clashing with browser globals elsewhere).
declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, opts?: { recursive?: boolean }): string;
  export function mkdtempSync(prefix: string): string;
  export function writeFileSync(path: string, data: string): void;
  export function rmSync(path: string, opts?: { recursive?: boolean; force?: boolean }): void;
}
declare module "node:os" {
  export function tmpdir(): string;
}
declare module "node:path" {
  export function join(...parts: string[]): string;
}
