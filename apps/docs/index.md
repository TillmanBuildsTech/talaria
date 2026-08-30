# Talaria — Product Docs

Talaria is evolving from *a chat app for your Hermes agents* into **a personal
Developer Portal — an all-in-one development tool you work alongside your Hermes
agents in**. This directory captures the product vision, the decisions that
shape it, and the plan for getting there. It is intentionally "paper-first":
we spec and argue here before writing code.

> `multi-agent-setup.md` is the **operational** guide (how to wire profiles to
> the gateway) and stays independent of the product planning docs below.

> **`apps/docs` today vs. tomorrow.** This directory is currently where we do
> product **planning** (paper-first). Its *end state* is a **Docusaurus**
> installation — the user-facing documentation site for how to use Talaria.
> Per-project documentation (written inside Talaria, stored on the Hermes
> server) is a *different* feature documented in [`projects.md`](projects.md).
> Don't conflate the two.

## Document map

| Doc | What it answers |
|---|---|
| [`vision.md`](vision.md) | **The north star.** What the portal is, what makes it unique, what it is *not*. |
| [`product-principles.md`](product-principles.md) | **The design tenets.** The rules every feature must obey (repo-gate mirroring, the autonomy dial, local-first, desktop/web parity). |
| [`agent-orchestration.md`](agent-orchestration.md) | **The core mechanic.** The Product Owner agent + kanban delegation model — powered by Hermes kanban. |
| [`agent-observability.md`](agent-observability.md) | **Trust & transparency.** Seeing what every agent is actually doing, and reviewing/approving their work. |
| [`projects.md`](projects.md) | **Per-project workspaces.** Each project has its own board, PO, tasks, chats, and markdown docs (stored on Hermes). |
| [`architecture.md`](architecture.md) | **How it's built.** One shared frontend on web + desktop, connected to the Hermes gateway and kanban engine. |
| [`roadmap.md`](roadmap.md) | **The plan.** What ships next (the MVP command center) and the path beyond. |

## Reading order

If you only read one file, read [`vision.md`](vision.md). If you want the whole
picture, read it in order: **vision → principles → orchestration →
observability → projects → architecture → roadmap**.

## Status

Planning phase — no feature code written yet. The current shipped state is the
multi-agent chat (PWA + desktop shell) described in the repo [`README.md`](../../README.md).
