// Ambient types for the shared /talaria-config and vercel-key server modules
// and the node builtins their unit tests touch. The PWA tsconfig deliberately
// targets the browser (lib DOM, no @types/node), so node:fs/os/path and the
// plain .mjs imports are untyped here. These loose declarations keep the
// config-module + vercel-key-module tests type-clean WITHOUT pulling
// @types/node into the global project (which would risk clashing with browser
// globals elsewhere).
declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, opts?: { recursive?: boolean }): string;
  export function mkdtempSync(prefix: string): string;
  export function writeFileSync(path: string, data: string, opts?: { mode?: number }): void;
  export function rmSync(path: string, opts?: { recursive?: boolean; force?: boolean }): void;
  export function readFileSync(path: string, encoding: string): string;
  export function statSync(path: string): { mode: number };
  export function chmodSync(path: string, mode: number): void;
}
declare module "node:os" {
  export function tmpdir(): string;
}
declare module "node:path" {
  export function join(...parts: string[]): string;
}

// Buffer is node-only; the browser tsconfig has no @types/node. Minimal global
// so the vercel-key module tests (which pass a 32-byte key Buffer) type-clean.
declare const Buffer: {
  from(data: string, encoding?: "hex" | "utf8"): { toString(enc: "utf8" | "hex" | "base64"): string };
  concat(list: Array<{ toString(enc: "utf8" | "base64" | "hex"): string }>): { toString(enc: "utf8" | "base64" | "hex"): string };
};
