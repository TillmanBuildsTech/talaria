# Architecture — How Talaria Is Built

> **Note:** this doc describes the *current + planned* architecture. The old
> `apps/pwa/DESIGN.md` describes an earlier **Vue 3** implementation that has
> since been re-platformed — the live stack is **React 19 + Zustand + Dexie** in
> a shared UI package. Treat this doc as the source of truth going forward.

## The shape in one picture

```
┌─────────────────────────────────────────────────────────────┐
│                    @talaria/ui  (shared frontend)            │
│   React 19 · Zustand · Dexie · Tailwind v4 · Vite           │
│   ─────────────────────────────────────────────────────     │
│   Modules:  Chat · Projects · Kanban · Observability · Docs editor ·       │
│             Repos · PRs · Deployments · (Code editor → desktop)           │
│   Services: hermes client · kanban client · projects/docs client ·        │
│             github client                                                 │
│   Stores:   projects · chat · kanban · agents · observability             │
└───────────────┬───────────────────────────┬─────────────────┘
                │ renders the same App()     │
      ┌─────────┴─────────┐         ┌────────┴─────────┐
      │  apps/pwa          │         │  apps/desktop     │
      │  thin Vite shell   │         │  Tauri 2 shell    │
      │  installable PWA   │         │  + code editor,   │
      │                    │         │  native fs/repos  │
      └─────────┬─────────┘         └────────┬─────────┘
                │                            │
                └──────────┬─────────────────┘
                           ▼
              ┌─────────────────────────────┐
              │   Your machine / gateway     │
              │  ┌─────────────────────────┐ │
              │  │  Hermes gateway         │ │  chat + profile multiplexing (/p/<profile>/)
              │  │  (API Server, SSE)      │ │
              │  └─────────────────────────┘ │
              │  ┌─────────────────────────┐ │
              │  │  Hermes kanban engine   │ │  tasks, dispatcher, max_in_progress
              │  └─────────────────────────┘ │
              │  ┌─────────────────────────┐ │
              │  │  GitHub (repos/PRs/CI)  │ │  branches, PRs, workflow_dispatch deploys
              │  └─────────────────────────┘ │
              └─────────────────────────────┘
```

## Core architectural principle: one frontend, two shells (P6)

Both the web **PWA** and the **desktop** app render the **same** React
`<App/>` from the shared `@talaria/ui` package. The shells are deliberately thin:

- **`apps/pwa/src/main.tsx`** — mounts `<App/>`, adds PWA/offline behavior.
- **`apps/desktop/src/main.tsx`** — mounts the identical `<App/>` inside a Tauri
  window.

Anything a module needs lives in `@talaria/ui`. A feature ships to both surfaces
at once by construction. The desktop app may layer on **desktop-only extras** —
a native code editor, direct filesystem/repo access, a local terminal — through
Tauri commands, but those are additive, never a fork of the shared logic.

> The UI package currently exports the chat `App` and its components. As the
> portal grows, the package's surface widens: each new module (kanban,
> observability, repos, …) is added *into* the package and mounted from both
> shells.

## Frontend stack (current)

| Piece | Choice | Role |
|---|---|---|
| **React 19** | Current | Component model; granular re-renders suit streaming |
| **Zustand** | Current | Lightweight global stores (chat today; kanban, observability next) |
| **Dexie (IndexedDB)** | Current | Local-first persistence (conversations, messages, agents, settings) |
| **Tailwind v4** | Current | Utility styling, dark theme |
| **Vite 8** | Current | Build + dev server for both shells and the UI package |
| **VitePWA** | PWA only | Manifest, service worker, offline shell |

**Local-first (P5):** Dexie/IndexedDB is the source of truth for UI state and
works offline. It's already the pattern — the portal extends it (kanban cache,
observability timeline, repo metadata) rather than introducing a server
database.

## How Talaria talks to Hermes

The existing `services/hermes.ts` client is the foundation and stays: it does
**SSE streaming** (`POST …/chat/completions`) with per-profile routing via
multiplexing (`/p/<profile>/v1/…`), optimistic UI, and exponential-backoff
retry. New modules add sibling clients:

| Module | Talks to | Contract |
|---|---|---|
| **Chat** | Hermes gateway (SSE) | `POST /api/v1/…/chat/completions`, `/p/<profile>/…` |
| **Kanban** | Hermes kanban engine | read/write task state — status, priority, deps, assignment, `max_in_progress`, **project scope** |
| **Projects / Docs** | Hermes server filesystem | per-project workspaces + markdown docs at `~/.hermes/projects/<project>/docs/` |
| **Observability** | Hermes gateway + kanban + git | sessions/activity streams, task state, tool output, artifact events |
| **Repos / PRs / CI** | GitHub (via gateway or desktop host) | branches, PRs, checks, merge/review actions |
| **Deployments** | GitHub Actions / host | `workflow_dispatch` triggers + status events |

A key design rule (from orchestration): **Talaria drives the existing Hermes
kanban state — it does not fork a parallel board.** So the kanban module is a
client/UI over the real dispatcher's data, not a second system of record.

## Project scoping & docs storage

Projects (see [`projects.md`](projects.md)) are the top-level organizing
namespace. Two things hang off them:

1. **Data partitioning.** Tasks, chats, and observability all carry a `project`
   scope. The store layer (Zustand + Dexie) keys these by project so switching
   projects swaps both the view and the data namespace (P9).

2. **Project docs on the server.** Markdown project docs live on the Hermes
   server at `~/.hermes/projects/<project>/docs/*.md` — **outside the repo** —
   so agents can read them as context when working in that project. The Docs
   editor module reads/writes these files (desktop via the filesystem; web via
   the gateway). This is distinct from `apps/docs`, which is the product's own
   user documentation (a future Docusaurus site, P10).

## Connecting to GitHub (auth decision)

Talaria needs to read/write repos, review PRs, and trigger deploys. Because it
is **local-first** (P5), the GitHub connection must not force a central
secret-holding server. Two supported mechanisms:

1. **OAuth Device Flow with a public Client ID (the "Login with GitHub"
   button).** The product registers **one** GitHub App once and embeds only its
   public **Client ID** — **no Client Secret**, so no central server is needed.
   The user clicks "Login with GitHub", enters a one-time code at
   `github.com/login/device`, and the app receives the token directly (same
   mechanism as the GitHub CLI `gh`).
   - **Desktop (Tauri):** runs natively — the app makes the HTTP calls itself,
     no CORS issue.
   - **Web (PWA):** the browser cannot poll GitHub's OAuth token endpoint
     directly (it sends no CORS headers), so the token exchange routes through
     the **user's own Hermes gateway** — the gateway (which the PWA already
     talks to) performs the device-flow exchange on the user's behalf. Because
     that's *their* machine/server, it stays local-first — no central Talaria
     cloud, just a local proxy for a call the browser sandbox can't make.
   - The resulting token lives on the user's machine (desktop) or in their
     local gateway/browser store (web) — never on a Talaria-hosted server.

2. **Fine-grained Personal Access Token (fallback).** User pastes a token with
   `repo`/`actions` scopes in Settings — zero product infrastructure, matching
   the existing API-key pattern. Preferred by some users; supported alongside
   device flow.

**Explicitly avoided:** a hosted OAuth broker or a secret-holding GitHub App
server. That is the Port/Cortex (multi-user SaaS) model and contradicts
Talaria's local-first, personal positioning. Users should never have to set up
their own GitHub App unless they specifically want org installs.

## Desktop-only capabilities (planned)

Tauri provides what a browser can't, cleanly behind the shared package boundary:

- **Code editor** — a real editor (Monaco/CodeMirror) to view & edit the code
  agents produce, surfaced as a desktop module.
- **Native repo access** — read/write local checkouts, run `git`, without a
  tunnel.
- **Local terminal** — optional shell pane.
- **Host-side automation** — trigger deploys / CI that a browser sandbox can't.

These are exposed as Tauri commands the shared UI calls through an abstraction,
so the same module renders a "not available on web" affordance when it's a
desktop-only capability.

## Evolution from today's chat to the portal

The portal is the same architecture with more modules. Nothing is thrown away:

1. **Now:** `@talaria/ui` renders the chat `App`; PWA + desktop both mount it.
2. **Next (M1):** add `kanban` and `observability` stores + components into
   `@talaria/ui`; give `App` a module switcher (Chat / Command Center); both
   shells pick it up automatically.
3. **Later:** repos/PRs/deployments modules in the shared package; the code
   editor as a desktop module behind the capability abstraction.

The shared-package architecture is precisely what makes "desktop and web mostly
equal" cheap: build it once in `@talaria/ui`, both surfaces inherit it.
