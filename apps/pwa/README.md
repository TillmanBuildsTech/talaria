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

## Deploy

The build is static — host `dist/` anywhere that serves static files (GitHub
Pages, Cloudflare Pages, Netlify, Vercel, nginx/Caddy). To connect, set the
gateway API URL and the profile keys under **Settings** in the app.

## Stack

React 19 · Vite · Zustand · Dexie (IndexedDB) · Tailwind CSS v4 · vite-plugin-pwa
— UI lives in the shared [`@talaria/ui`](../../packages/talaria-ui) package.

See [`DESIGN.md`](DESIGN.md) for architecture notes and the multi-agent
routing contract.
