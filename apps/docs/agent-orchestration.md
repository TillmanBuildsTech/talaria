# Agent Orchestration — The Product Owner + Kanban Model

The heart of Talaria is **delegation**: you talk to one **Product Owner (PO)
agent**, it breaks your request into tasks, and those tasks are worked by
specialist agents through a **kanban board** — all visible, all steerable, from
one screen. This is the mechanic that makes Talaria "not another chat."

## Why this exists

Running N agents across N chat windows means you are the dispatcher — reading
every reply, deciding who does what, chasing down state. Talaria inverts that:

- **One conversation surface** (the PO) instead of N windows.
- **One source of truth** for task state (the board) instead of scattered
  chats.
- **Delegation by the PO**, not by you micromanaging.

The PO agent is your interface; the kanban board is the memory and the control
plane.

## Powered by Hermes kanban

This is not a from-scratch system. **The existing Hermes kanban dispatcher IS
the engine** that powers PO delegation. The dispatcher already provides:

- Task lifecycle (todo → in-progress → done / blocked) and priorities (P0…
  P3).
- **Dependencies** between tasks (parents must be done before a child is
  claimable).
- **Concurrency control** (`max_in_progress`) — a host-wide cap on how many
  agents run at once, and a tick that refills reclaimed slots.
- **Specialist assignment** — tasks are claimed by the profile whose specialty
  matches (researcher → research, developer → code, QA → verification).
- A decomposer that can split a request into runnable, small tasks.

The PO agent in Talaria sits **on top of** this dispatcher: it receives your
request, decomposes it into well-formed tasks (title = outcome, body = context +
acceptance criteria + pointers), and hands them to the dispatcher. Talaria is
the **UI** that makes the board and the PO legible and interactive.

> Design rule: Talaria renders and drives the existing Hermes kanban state. It
> does **not** fork it into a parallel system — that would create two sources of
> truth and violate P5 (local-first, one system).

## Autonomy modes (P2 — a dial, not a switch)

How involved you are is **your call, per task**. Three named settings on the
dial, all powered by the same kanban + dispatcher:

| Mode | You do | PO does | Feels like |
|---|---|---|---|
| **Swarm** (default) | One request; review + gate outcomes | Decomposes, assigns, dispatches; agents run autonomously | "Get as much done as you can without me" |
| **Supervised** | Approve the PO's task breakdown before dispatch | Proposes plan + tasks; waits for your go | Plan-then-approve |
| **Manual** | You pick agent + task, one at a time | Acts as a normal agent you command | Classic Hermes kanban, you are the dispatcher |

Switching modes changes **only how tasks are created and dispatched** — never
the safety rails. The same board, same dispatcher, same verification rules
underpin all three. Default is swarm, because that's the point: you stop
managing windows.

## How a request flows through the PO (swarm mode)

1. **You ask the PO** — "port the scraper to the new API."
2. **PO decomposes** — splits into small, single-session tasks: *research the
   new API* (→ researcher), *update the scraper* (→ developer), *write tests* (→
   developer), *verify against live API* (→ QA).
3. **PO writes well-formed tasks** — each with title (imperative outcome), body
   (context + acceptance criteria + pointers to files/URLs), priority, and
   parent/child dependencies.
4. **Dispatcher runs them** — respects `max_in_progress`, claims by specialty,
   waits on dependencies.
5. **You watch & gate** — observability pane (see
   [`agent-observability.md`](agent-observability.md)); you approve PRs, review
   diffs, release merges.
6. **Done = verified** — a task only closes when its artifact exists: a commit
   on a real branch, an open PR, a live deployment. The PO confirms against the
   artifact, not the agent's word.

## Kanban states & hygiene

The board mirrors the dispatcher's lifecycle, surfaced as a real kanban UI:

- **Triage / Ready / In-progress / Review / Blocked / Done** (the UI may add a
  visual "Review" column between in-progress and done to represent the human
  gate).
- **Blocked is a loud state.** Per the working agreement, a blocked task older
  than 7 days without a comment is a failure state — Talaria surfaces stale
  blockers and prompts you to unblock, re-scope, or archive.
- **Kill zombie tasks.** If a task is superseded or the request is dropped, it
  gets archived — the board never rots with half-done items.

## Task shape (the PO's contract)

Every task the PO writes must be complete enough to execute without you:

- **Title** — imperative outcome ("Port scraper to v2 API").
- **Context** — why it matters, what the user gets.
- **Acceptance criteria** — what "done" verifiably looks like.
- **Pointers** — files, URLs, branches to start from.
- **Specialty** — which agent type should claim it.
- **Dependencies** — parents that must finish first.

A task without acceptance criteria is not ready for dispatch — the PO finishes
it or the task stays in triage.

## What the user gets

- Stop managing chat windows; one PO relationship.
- A board that is the honest, live state of all work in flight.
- Full control over involvement — swarm it, or micromanage it, per task.
- Work that tracks itself and reports against real artifacts.
