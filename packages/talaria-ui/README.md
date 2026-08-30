# @talaria/ui

Shared chat UI for Talaria — the components, Zustand store, Hermes API client,
and IndexedDB persistence layer used by both `apps/pwa` and `apps/desktop`.

Host apps own their own document shell, routing, PWA manifest, and dev server
config; this package only owns the chat experience itself.

## Scripts

- `pnpm build` — build the library (`dist/`)
- `pnpm test` — run unit/component tests
- `pnpm lint` — Biome check
