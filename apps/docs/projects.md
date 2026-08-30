# Projects — Per-Project Workspaces

The Command Center is not one giant board — it's organized around **Projects**.
Each project is a self-contained workspace: its own kanban board, its own PO
agent and tasks, its own chats, and its own **project documentation**. When you
are inside a project, everything you see and change is scoped to that project.

> **Example.** You open Talaria and pick the **ABC** project. You now see only
> ABC's kanban, ABC's agents at work, ABC's docs, and ABC's chats. A task you
> create, a doc you edit, a message you send — all ABC. Switch to **serv** and
> the whole view changes to serv's world.

This is the organizing principle that turns Talaria from "one big board" into a
tool you can actually run multiple pieces of work in without cross-talk.

---

## What a Project contains

| Piece | What it is | Scoped how |
|---|---|---|
| **Board** | The project's kanban (Triage / Ready / In-progress / Review / Blocked / Done) | Every task belongs to exactly one project |
| **PO agent** | The project's own Product Owner — the interface for *this* project | PO conversations/context are per-project |
| **Agent tasks** | The specialist work the PO delegated for this project | Tasks carry a `project` scope |
| **Chats** | Conversations with agents, scoped to this project's work | Each chat belongs to a project |
| **Docs** | Markdown project documentation (see below) | Stored per-project, outside the repo |
| **Repos** (later) | Repos this project works on | Project ↔ repo association |
| **Deployments** (later) | Deploys for this project's repos | Tagged by project |

## The core rule: scoping is a filter AND a namespace

A project is not just a *filter* over one shared pile of tasks — it is a
**namespace**. Data is partitioned by project so that:

- Two projects can have tasks, chats, and docs that don't collide.
- A change you make inside project ABC stays in ABC.
- Agent context (what the PO and specialists know) is scoped — working in serv,
  agents load serv's docs and tasks, not ABC's.

This mirrors how you actually think: each piece of work has its own folder in
your head. Talaria gives it its own folder on the server.

---

## Project documentation (the in-tool markdown editor)

Each project has a **Docs** section: markdown files you write and edit inside
Talaria with a built-in markdown editor. These are **project docs**, distinct
from the product's own `apps/docs`.

### Where project docs live

- **On the Hermes server**, not in the repo and not in `apps/docs`. The natural
  home is a per-project directory the gateway/agents already read from, e.g.
  `~/.hermes/projects/<project>/docs/*.md` (aligned with how Hermes projects and
  worktrees are already laid out).
- Storing them on the Hermes server means **agents can read them as context**
  when working inside that project — the PO and specialists load the project's
  docs automatically, so your written design notes steer their work.
- Because they live outside the repo, project docs can hold things that
  shouldn't be committed to a code repo (internal design decisions, ADRs,
  meeting notes, roadmap rationale) while still being accessible to both you and
  the agents.

### What distinguishes project docs from `apps/docs`

| | `apps/docs` (this directory) | Project docs (in-Talaria) |
|---|---|---|
| **Audience** | End users of the Talaria product | You + the agents working that project |
| **Content** | How to use Talaria, product planning | A project's design, ADRs, notes, specs |
| **Location** | In the repo (checked in) | On the Hermes server, per-project |
| **Editor** | Code editor / Git | Talaria's markdown editor |
| **Lifecycle** | Eventually a **Docusaurus** site (see below) | Living project knowledge |

> **`apps/docs` today vs. tomorrow.** Right now `apps/docs` is where we do
> product planning (these very files). That's intentional for the planning
> phase. But the *end state* for `apps/docs` is a **Docusaurus** installation —
> the user-facing documentation site for how to use Talaria. Project docs are a
> **different** feature: per-project markdown that never becomes user docs.
> Don't conflate the two; they serve different readers and live in different
> places.

## How the PO uses project docs

When you ask the PO to do something in a project, it has immediate access to
that project's docs as part of its context. So a well-maintained doc like
"ABC — scraper architecture" means the PO and the developer agent already know
the architecture without you re-explaining it. Docs are the project's shared
memory.

## Project selection & switching

- A **project picker** sits at the top of the command center (like the current
  profile selector, but for projects).
- Switching projects swaps the entire view: board, agents, chats, docs.
- Creating a task, starting a chat, or writing a doc while a project is active
  auto-tags it with that project.
- A **global / unassigned** scope exists for anything that isn't project-bound
  (e.g. one-off questions) — a lightweight home so you're not forced to create a
  project for everything.

## What the user gets

- Run multiple pieces of work without cross-talk — no more one giant board or
  mixing ABC and serv in the same view.
- Each project carries its own board, PO, tasks, chats, and docs.
- Project docs are written in Talaria, stored on Hermes, and **injected into
  agent context** so agents work from your written designs.
