# Product Principles

These are the design tenets every Talaria feature must obey. When a feature
conflicts with a principle, the principle wins. These encode *how* we decide,
so we don't have to re-litigate the same arguments on every task.

---

## P1 — Your repo's rules are the app's rules

Talaria **mirrors** the real workflow of the repos it works on; it never invents
a stricter (or looser) process than the underlying repo enforces.

- If a repo doesn't gate `main` pushes and doesn't enforce PRs, the portal
  won't impose PR ceremony on it either — agents can push straight to `main`,
  because that's how *you* work.
- If a repo *does* gate `main` (protected branch, required CodeQL, squash-only
  merges — like `serv`), the portal surfaces and honors those gates: agents open
  PRs, the portal shows the required checks, and approvals respect the same
  constraints you'd face on GitHub.
- **The app is never more or less permissive than the repo.** The portal is a
  window onto your real workflow, not a new process bolted on top of it.

**Acceptance:** for any repo connected to the portal, the agent behavior the
portal enables is a faithful reflection of that repo's actual branch/PR/merge
policy.

---

## P2 — Autonomy is a dial, not a switch

How much you babysit agents is **your choice, per moment** — a spectrum, not a
binary.

- **Swarm (default).** You talk to the Product Owner agent; it decomposes work,
  assigns tasks to specialist agents, and they execute autonomously. You steer
  at the *outcome* level and gate approvals. This is the "let the PO get as much
  done as possible without me" mode.
- **Manual.** You pick which agent does what, one task at a time — the classic
  Hermes kanban flow where you are the dispatcher.
- **Everything between.** A mid level where the PO proposes a plan and you
  approve task-by-task before agents run.

The dial's setting is a **per-task or per-project** property, not a global
lock. A simple, fire-and-forget task can swarm; a risky refactor can be manual.

**Acceptance:** the autonomy mode is a first-class, switchable setting that
changes only how tasks are *created and dispatched* — never the underlying
safety rails the repo/workflow provides.

---

## P3 — Agents are first-class, and their work is visible

You should never have to *trust* an agent's word that something happened —
you should be able to **see** it.

- Every agent's live activity, tool calls, and outputs are observable
  (see [`agent-observability.md`](agent-observability.md)).
- A task is only "done" when it's **verified against a real artifact** — a
  branch that exists, a commit SHA, an open PR, a live deployment. A chat reply
  of "done" is not done.
- Review is built in: you can inspect the diff, approve or request changes
  before an agent's work proceeds.

**Acceptance:** no claim of completed work is accepted by the UI without a
linkable artifact proving it.

---

## P4 — One pane of glass

Talaria's core value is **reducing window-juggling**. The whole dev loop lives
in one screen: chat/inbox, kanban, agent observability, repos, PRs, CI,
deployments, and (on desktop) the code editor.

- New features integrate *into* the existing surface; we don't spawn a new
  window or a new tab for each concern.
- Context-switching should drop, not grow, as the product matures.

**Acceptance:** a user can go from *requesting work* to *reviewing and shipping
it* without leaving the app or opening another tool.

---

## P5 — Local-first and personal

Talaria is **your** tool. Data and control live on your machine, by default
offline-capable. No mandatory cloud, no hidden telemetry.

- Local persistence (IndexedDB/Dexie today) is the source of truth for the UI.
- The web build is a first-class citizen but still talks to *your* gateway —
  there's no Talaria-hosted backend that becomes a single point of failure or a
  privacy leak.

**Acceptance:** the product works fully on a developer's own machine against
their own Hermes gateway, with no required external service.

---

## P6 — Desktop and web share one brain

Desktop (Tauri) and web (PWA) render the **same** frontend logic from the shared
`@talaria/ui` package. They are equal by default.

- Anything available on web is available on desktop, and vice versa — the
  shared frontend is the contract.
- The desktop app may add **desktop-only extras** (e.g. the code editor, native
  filesystem/repo access, a local terminal) — additive power, not divergence.

**Acceptance:** no feature ships to one surface without a plan (build it in the
shared layer, or explicitly justify the desktop-only split).

---

## P7 — The Product Owner agent is your single interface

You stop juggling N agent windows. You talk to **one** Product Owner agent; it
owns the kanban board, decomposes requests, and delegates to specialist agents.
Direct agent DMs remain *available* (they're the "manual" end of the dial) but
the **default** relationship is a single trusted interface.

**Acceptance:** the common case — "get this done" — requires exactly one
conversation surface, the PO, and the work fans out and tracks itself on the
board.

---

## P8 — Reduce friction, never add ceremony

Talaria is a speed tool. Every feature should make the developer *faster* or
*give them more trust*. We aggressively cut anything that adds clicks, steps, or
ritual without returning value.

**Acceptance:** each planned feature states the friction it removes and the
trust it adds, in its spec — if it adds neither, it's cut.

---

## P9 — Everything is scoped by project

Talaria is organized around **projects**: each project is a self-contained
workspace with its own board, PO agent, tasks, chats, and markdown docs
(see [`projects.md`](projects.md)). A project is a **namespace**, not just a
filter — data is partitioned by project so multiple projects never collide or
cross-contaminate.

- What you see *and* what you change while inside a project is scoped to it.
- Two projects can have independent tasks, chats, and docs with no overlap.
- **Agent context is per-project** — a project's docs and tasks are what the PO
  and specialists load when working there.

**Acceptance:** switching projects swaps the whole view and the whole data
namespace; nothing from one project leaks into another.

---

## P10 — `apps/docs` is user docs; project docs are separate

`apps/docs` is the product's own documentation — today it's planning, and its
**end state is a Docusaurus site** for end users. It is **not** where users
store per-project knowledge. Project documentation is a separate feature:
markdown written inside Talaria, stored on the Hermes server per-project, and
injected into that project's agent context.

**Acceptance:** the two are never conflated — `apps/docs` documents Talaria
itself; project docs document a project's design and notes, stored outside the
repo.
