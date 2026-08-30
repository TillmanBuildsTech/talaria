# Vision — Talaria Developer Portal

## The one-liner

> **Talaria is an all-in-one development tool you work *alongside* your Hermes
> agents in — see everything they're doing, steer them, and run your whole dev
> loop (code, repos, PRs, deployments) from one screen.**

Talaria started as a PWA chat for talking to your Hermes agents. That's a
feature, not the product. The product is a **personal Developer Portal**: the
single window where you and your agents get work done together.

## Why this matters (the problem we're solving)

Running agents across N chat windows is chaos:

- You have a **window per agent**, and you have to babysit each one.
- Agents **claim they did things** but you can't see the work — did that branch
  actually get pushed? Did that PR actually open? Is the deployment actually
  live?
- There's **no central task state** — no single place that says *what's in
  flight, who owns it, what's blocked, what's done*.
- The *real* dev loop — reading code, reviewing diffs, checking CI, merging PRs,
  shipping — lives in **other tools**, so you context-switch constantly.

Talaria collapses this. One screen, one command center, your agents as visible,
reviewable collaborators instead of black-box chat bots.

## What makes it unique (not "another chat")

| Ordinary chat app | Talaria Developer Portal |
|---|---|
| You talk to agents | You talk to **one Product Owner agent** who manages the rest |
| Replies stream in and vanish | Agent work is **observable** — live activity, logs, task state, artifacts |
| You trust what agents *say* | You can **see what agents *did*** — the branch, the diff, the PR, the deploy |
| Chat is the whole app | Chat is **one module**; code editor, repos, PRs, deployments live beside it |
| Agents are disconnected chats | Agents work a shared **kanban board** you can steer |
| Work happens in other tools | The whole dev loop is **one pane of glass** |

The closest analog in spirit is an **Internal Developer Portal** (Port, Cortex):
one place to see and run the whole dev lifecycle. But those are org products
built for teams, with RBAC, service catalogs, and scorecards. Talaria is the
**personal, local-first** version — built for one developer and their agents, on
their own machine.

## Product definition

**Talaria is:**

- **Local-first.** Your data and control live on your machine. No mandatory
  cloud, no telemetry you didn't opt into. (Desktop and web share the same
  frontend, but it's *your* data.)
- **A control plane, not a bystander.** You direct work, agents execute in the
  background, and you review/approve what they produce. Or you hand them the
  reins and just gate the outcomes.
- **Organized around projects.** Each piece of work is its own workspace — its
  own board, PO agent, tasks, chats, and markdown docs — so multiple projects
  run side by side without cross-talk (see [`projects.md`](projects.md)).
- **An observability surface.** Every agent's activity is visible and
  replayable — not just their chat replies.
- **A workflow integrator.** Repos, PRs, CI, deployments are first-class, so
  "agent said done" becomes verifiable against real artifacts.

**Talaria is NOT:**

- **Not a multi-user / team product.** Single user, single machine. No RBAC, no
  org service catalog, no scorecards, no team onboarding. If we ever grow there,
  it's a deliberate, separate decision — not scope creep.
- **Not a replacement for the Hermes gateway.** It's a rich client + command
  center *on top of* Hermes (which remains the agent runtime and the kanban
  engine).
- **Not a generic AI chat** (ChatGPT-style). It's a *development environment*
  whose collaborators happen to be agents.

## The north-star scenario

You open Talaria. A clean command center shows your **projects**; you pick one
— say, the scraper migration — and its kanban board appears: what's in flight,
what's blocked, what's waiting on you. You type one request to that project's
**Product Owner agent** — "port the scraper to the new API." The PO decomposes
it into tasks, assigns them to the researcher/developer/QA agents, and they
swarm it. In the observability pane you watch each agent work in real time;
when the developer opens a PR, it appears in the repo view; you review the diff
in the built-in editor, approve, and watch it merge and deploy — all without
leaving the app, and without opening a single other window. Its docs live in
the project, on the server, where the agents read them as context.

That is the product. Everything else in these docs is the path to it.

## What the user gets (always ask this)

Every decision in this product is justified by one question: **"does this get
the developer closer to shipping, with less window-juggling and more
trust?"** If a feature doesn't move that needle, it doesn't ship.
