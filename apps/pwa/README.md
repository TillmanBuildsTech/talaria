# Talaria

**Talaria** is a zero-friction, installable **PWA** for talking to every
[Hermes Agent](https://github.com/NousResearch/hermes-agent) profile you run —
each profile as a separate **contact/agent**. Message any profile directly, add
several to a **group chat**, and `@`-mention one to route a message to it.

Tap **Add to Home Screen** and you have a native-feeling mobile client for your
agents. No app store, no native build.

## Features

- 🧑‍🔬 **Agents as contacts** — every Hermes profile appears in the sidebar with
  its own avatar & color; tap to DM.
- 💬 **Direct messages** — 1:1 with any profile via the gateway's profile
  multiplexing (`/p/<profile>/v1/chat/completions`).
- 👥 **Group chats** — add 2+ agents to one room.
- 🔗 **`@`-mentions** — `@developer` routes to that agent, `@all` fan-out to
  everyone, unaddressed messages go to the room's primary member.
- 📡 **SSE streaming** with optimistic UI, offline-first IndexedDB persistence,
  and exponential-backoff retry.
- 🔒 **Per-agent API keys** — each profile authenticates with its own
  `API_SERVER_KEY`.

## Requirements

- A running **Hermes gateway** with the **API Server** platform enabled, and
  **profile multiplexing** turned on so multiple profiles can be reached:

  ```yaml
  # in the gateway profile's config.yaml
  gateway:
    multiplex_profiles: true
  ```

- One API key per profile you want to talk to (multiplexing scopes the key per
  profile).

> Full setup, gotchas, and verification are in
> [`multi-agent-setup.md`](../docs/multi-agent-setup.md).

## Development

This app is a thin host around the shared [`@talaria/ui`](../../packages/talaria-ui)
package, which owns the actual chat UI. Run from the repo root:

```bash
pnpm install
pnpm --filter @talaria/pwa dev        # Vite dev server (proxies /api → localhost:8642)
pnpm --filter @talaria/pwa build      # Production build → dist/
pnpm --filter @talaria/pwa preview    # Serve the production build locally
```

> The PWA imports the **built** `@talaria/ui` (`dist/index.js`), and the Vite dev
> server does not rebuild workspace dependencies. Always run
> `pnpm --filter @talaria/ui build` after changing `packages/talaria-ui` (or run
> `pnpm --filter @talaria/ui dev` for a watch build) — otherwise the dev server
> serves a stale UI.

## Tests

```bash
pnpm -r test                          # unit tests (vitest, @talaria/ui)
pnpm --filter @talaria/pwa test:e2e   # Playwright smoke suite (chromium)
```

The Playwright suite (`e2e/`) boots the app twice — Vite dev server and the
production `preview` build — and walks every NavRail module (chat, command
center, observability, wip, deployments, docs, editor, settings), asserting each
module's own content renders, nav swaps cleanly with no cross-module leakage,
the editor degrades gracefully on web, and the PWA installability surface
(manifest, icons, service worker) is intact. Results and the defects it found
live in [`e2e/DEFECT_REPORT.md`](e2e/DEFECT_REPORT.md); the first run needs
`npx playwright install chromium`.

## Deploy

The build is static — host `dist/` anywhere that serves static files (GitHub
Pages, Cloudflare Pages, Netlify, Vercel, nginx/Caddy). To connect, set the
gateway API URL and the profile keys under **Settings** in the app.

## Stack

React 19 · Vite · Zustand · Dexie (IndexedDB) · Tailwind CSS v4 · vite-plugin-pwa
— UI lives in the shared [`@talaria/ui`](../../packages/talaria-ui) package.

Product vision and planning live in [`apps/docs`](../docs) — the end state for
`apps/docs` is a Docusaurus user-documentation site. (The old `DESIGN.md` and
`IDEA.md` here were removed: they described the pre-React/Vue implementation
and an unrelated idea.)
