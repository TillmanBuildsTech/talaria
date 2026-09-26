# Talaria PWA smoke suite — run results & defect report

Run date: 2026-09-11 · branch `wt/playwright-smoke` (merged up to `origin/dev` @ 41 commits ahead of the original branch point)
Suite: `apps/pwa/e2e` (Playwright, chromium) · command: `pnpm --filter @talaria/pwa test:e2e`

```
36 passed · 4 skipped · 0 failed   (dev + preview projects, wall clock ~52s)
unit: @talaria/ui — 31 files, 292 tests passed
```

The 4 skips are the PWA-installability specs on the `dev` project (they only run
against the `preview` production build, where `vite-plugin-pwa` generates a real
service worker + precache manifest).

## How to run

```bash
export PATH=/root/.hermes/node/bin:$PATH                 # Node 22
export PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright
export TMPDIR=/root/tmp                                  # /tmp is a small tmpfs
cd <repo>/apps/pwa
pnpm add -D @playwright/test && npx playwright install chromium   # first time
pnpm test:e2e
```

`playwright.config.ts` starts both servers itself (`@talaria/ui build` → `pwa
dev`, and `@talaria/ui build` → `pwa build` → `pwa preview`) and reuses an
already-running server if one is up.

## What the suite covers

| # | Module | Assertion | Result |
|---|--------|-----------|--------|
| 1 | chat | empty state renders, `textarea` enabled, `Send` present, `Stop generating` absent while idle | PASS |
| 2 | command-center | KanbanBoard mounts — toolbar `live Hermes kanban` + a board area state (board / `No tasks` / locked / loading), never blank or `coming soon` | PASS |
| 3 | observability | `Agent Observability` panel + `Agent timeline` / task-history controls mount | PASS |
| 4 | wip | WipView mounts (GitHub gate or repo list) — **replaces the removed `repos` + `prs` modules** | PASS |
| 5 | deployments | Deployments mounts (GitHub gate or workflow picker / refresh control) | PASS |
| 6 | docs | `Project Docs` panel + per-project empty state mount | PASS |
| 7 | editor | desktop-only: rail entry `disabled`, `title="Editor — desktop only"`, app stays interactive (no crash) | PASS |
| 8 | settings | `Hermes Gateway API Server key` renders; `Close settings` returns to chat | PASS |
| 9 | cross-module leakage | chat → observability → command-center → docs → settings: each shows its own body marker **and the previous module's marker is gone** | PASS (4/4) |
| 10 | nav rail integrity | rail exposes exactly the current `NavModuleId` set; removed `Repos` / `Pull Requests` entries must not reappear | PASS |
| 11 | PWA installability (preview only) | `manifest.webmanifest` loads, `display: standalone`, name, icons declared + present in built `dist`; `sw.js` serves the workbox SW; `registerSW.js` served and wired; SW registers; manifest + `apple-touch-icon` linked; `viewport-fit=cover` + `theme-color` | PASS |

Module set note: this card listed `repos` and `prs` as separate modules, but
`NavModuleId` on `dev` no longer has them — the repo/PR browser now lives inside
the single `wip` (Work In Progress) module (`WipView`). The suite smokes `wip`
and additionally guards that the old rail entries cannot come back.

Determinism: gateway-backed modules are exercised against a stubbed gateway
surface (`installGatewayStub`: `/api/**` → 503, `/kanban-api/**` → 401,
`/talaria-config` → 404) so every module renders a repeatable empty/unauthorized
state. One test per project deliberately runs **unstubbed** against the real
gateway to prove the suite is not only green because of the stub.

## Defects found

### D1 — GitHub-backed reads 404 through the Vite dev server (`POST /api/v1/github/proxy`)

- **Severity:** medium (dev-server only; production `serve.mjs` implements the route)
- **Module:** deployments (and any GitHub read: `wip` repo list / PR counts when
  an account is connected)
- **Symptom:** selecting **Deployments** issues `POST /api/v1/github/proxy` on
  mount (to list workflows) and gets **404**. Console:
  `Failed to load resource: the server responded with a status of 404 (Not Found)`.
  The module falls back to `workflowsError` (`Could not load workflows`), so the
  workflow picker can never populate against a dev server.
- **Evidence:**
  - browser: `404 POST /api/v1/github/proxy` immediately after clicking Deployments (only failed request in the whole run)
  - `curl -X POST http://127.0.0.1:8642/api/v1/github/proxy` → `404`
  - the Hermes gateway does not serve the `/api/v1/*` prefix at all: `/api/v1/version` → 404, `/api/v1/health` → 404, while `/health` → 200 and `/v1/models` → 401
  - `apps/pwa/vite.config.ts` proxies `/api` → `localhost:8642`; it defines
    `githubProxyDev()` only as the *server-side* callback used by the
    deploy-dispatch middleware, but never registers a middleware for the
    browser-facing `/api/v1/github/proxy` path (unlike `serve.mjs`, whose
    `githubProxyFactory` does).
- **Repro:** `pnpm --filter @talaria/ui build && pnpm --filter @talaria/pwa dev`
  → open `/` → click **Deployments** → DevTools Network shows
  `POST /api/v1/github/proxy` → 404.
- **Fix direction (out of scope for this card):** add a dev middleware for
  `/api/v1/github/proxy` (and `/api/v1/github/device/*`) in
  `apps/pwa/vite.config.ts`, mirroring `serve.mjs`'s `githubProxyFactory`, or
  implement the GitHub proxy on the gateway and point the dev proxy at it.

### D2 — stale `@talaria/ui` dist makes the dev server serve an app that no longer exists in source

- **Severity:** medium (test/dev tooling; silently green-lights wrong assertions)
- **Symptom:** `apps/pwa/src/main.tsx` imports `@talaria/ui` → the **built**
  `packages/talaria-ui/dist/index.js`. The Vite dev server does not rebuild a
  workspace dependency, so after this branch merged `origin/dev` the dev server
  kept serving a dist built 11 days earlier: the NavRail showed the removed
  `Repos` / `Pull Requests` modules and the first suite run asserted against an
  app the source tree no longer contains.
- **Evidence:** `curl http://localhost:5174/@fs/<worktree>/apps/pwa/src/main.tsx`
  → `import { App } from ".../packages/talaria-ui/dist/index.js"`; the mergetree
  `nav-rail.tsx` has `wip`, the served bundle had `prs`.
- **Fix applied here:** the Playwright `webServer` commands now run
  `pnpm --filter @talaria/ui build` before starting either server, and a
  `nav rail exposes exactly the current NavModuleId set` test fails loudly if the
  served app disagrees with `NavModuleId`.

### D3 — PWA icon paths 404 **on this host only** (environment artifact, not an app defect)

- **Severity:** informational
- **Symptom:** on this LXC host, `GET /pwa-192x192.png` and `/pwa-512x512.png`
  return `404` with `server: Python/3.11 aiohttp/3.14.3`, while
  `/apple-touch-icon.png` — another file in the same `public/` directory served
  by the same Vite server — returns `200` (Vite ETag headers).
- **Evidence:**
  - a byte-identical copy at `/test-icon.png` → **200** from the same server
  - the same directory served by a plain static server (`node http` on :5399)
    → `pwa-192x192.png` **200**, `pwa-512x512.png` **200**
  - the 404 response headers come from an aiohttp process, not Vite
- **Conclusion:** a host-level HTTP interceptor (this sandbox's egress proxy)
  rewrites those two literal paths. Not fixable in the repo, and it does not
  reproduce on a clean host. Because of it, icon assertions verify (a) the
  manifest declares both icons and (b) both files exist in the built `dist`;
  `sw.js` / `registerSW.js` / SW registration are still verified over HTTP.
  Residual risk: an in-browser "install prompt" check on this host cannot be
  trusted, since the icon fetch itself is intercepted here.

## No other defects

Every other module navigates, mounts, and swaps cleanly with **zero uncaught
page errors** in both the stubbed and the real-gateway runs; the only failed
network request in the entire unstubbed run is D1.
