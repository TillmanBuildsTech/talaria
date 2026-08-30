# Roadmap — From Chat to Developer Portal

How Talaria evolves from *a chat app* to *a personal Developer Portal*, in
milestones. Each milestone is a coherent, shippable vertical slice — **not** a
phase of an endless mega-build. We ship, use it, learn, and only then build the
next slice.

> Guiding rule (P8): every milestone states **what the user gets** and its
> acceptance criteria. A milestone that adds ceremony without value gets cut.

---

## M0 — Today's foundation (shipped)

The multi-agent chat: PWA + desktop shell sharing `@talaria/ui`, profile
multiplexing, DM/group/@-mentions, SSE streaming, local-first Dexie storage.

**What the user gets:** a single chat surface for all their agents, on web and
desktop.

---

## M1 — Command Center (the MVP of the portal) ← **NEXT**

The first slice that makes Talaria a *portal* instead of a chat. Three modules,
all in `@talaria/ui`:

### 0. Projects (the organizing layer)
- A **project picker** at the top of the command center; switching projects
  swaps the whole view (board, agents, chats, docs).
- Project is a **namespace** (P9) — tasks/chats/docs are partitioned per
  project. A lightweight **global/unassigned** scope exists for one-off work.
- Each project has its own PO agent and task scope.

### 1. Kanban command center
- Render the **real Hermes kanban** board (drives it, not a parallel system),
  **scoped to the active project**.
- Columns: Triage / Ready / In-progress / Review / Blocked / Done.
- Task detail: title, context, acceptance criteria, priority, specialty,
  dependencies, artifacts.
- Autonomy dial per task: **Swarm / Supervised / Manual** (see orchestration).
- Blocked-task hygiene: stale-blocker prompts, archive/kill-zombie.

### 2. Agent observability
- Live **activity feed** (every agent's actions + tool calls, streaming),
  filterable by **project**, agent, task.
- Per-agent timeline, task-scoped history, replayable.
- **Artifacts**: branches, commits, PRs, CI runs, deploys — linked & verifiable.
- **Diff review** before approving work (respecting the repo's real gates).

### 3. Project docs (markdown editor)
- A **Docs** section per project: read/write markdown via an in-app editor.
- Stored on the Hermes server at `~/.hermes/projects/<project>/docs/`, **outside
  the repo** — distinct from `apps/docs` (P10).
- Project docs are **injected into agent context**, so the PO and specialists
  work from your written designs.

### How the PO agent fits
The PO agent becomes the default entry point: you talk to it, it decomposes
into kanban tasks, and the command center shows the result. This is the
"not another chat" moment — delegation + visibility in one screen.

**What the user gets:** stop juggling windows; one board + one live view of all
agents; work that tracks itself against real artifacts.

**Acceptance criteria:**
- The kanban board reflects live Hermes kanban task state (no forked system),
  scoped to the active project.
- Switching projects swaps the board, chats, and docs namespace (P9).
- Project docs are readable/writable in-app and stored on the Hermes server
  outside the repo.
- Agent activity streams in real time; history is replayable per task/agent.
- "Done" is only shown when backed by a verifiable artifact.
- Both PWA and desktop mount the new modules (P6).

---

## M2 — Workflow integration (repos, PRs, CI)

Extend the command center into the actual dev loop:

- **GitHub connection** — "Login with GitHub" via **OAuth Device Flow** (public
  Client ID, no secret, no central server) plus fine-grained **PAT** fallback
  (see architecture — auth decision).
- **Repo browser** — connected repos, branches, recent commits.
- **Pull requests** — list, review, approve/request-changes, merge — honoring
  the repo's real gates (P1): protected branch, required checks, squash-only.
- **CI status** — checks/runs surfaced per branch and PR.
- **Deployments** — trigger via `workflow_dispatch` and watch status, all from
  one screen.

**What the user gets:** the whole "review and ship" loop without opening GitHub.

**Acceptance criteria:**
- PR actions in the portal respect the repo's enforced gates exactly.
- A deployment can be triggered and its status observed from the app.
- Every artifact shown is linkable back to the source of truth.

---

## M3 — Code editor (desktop anchor)

The built-in editor to view and edit what agents produce:

- Read code in the repo view / diff view; open files; edit; save to a branch.
- Desktop-only (per the form-factor decision), exposed behind the capability
  abstraction so web degrades gracefully.
- Tight loop with agents: agent writes code → you open it in the editor →
  approve/revise → it continues.

**What the user gets:** never leave the portal to read or touch the code agents
wrote.

**Acceptance criteria:**
- Open a file/diff and edit it in the desktop app.
- Web surface renders a clear "desktop-only" affordance without breaking.

---

## M4 — Deeper autonomy & trust

Polish the dial and the trust model:

- Smarter PO decomposition (learns your conventions, proposes better task
  shapes).
- Richer review flow: comment threads, change-requests routed back to the
  responsible agent, re-verification.
- Trust scoring / provenance: what an agent actually touched vs. claimed.

**What the user gets:** trust the swarm more, intervene less.

---

## M5+ — Future / stretch

- Local terminal pane (desktop).
- Plugin/skill registry surfaced in the portal.
- Cross-repo orchestration ("update serv and talaria together").
- Anything the north-star scenario demands that M1–M4 don't cover.

These are deliberately uncommitted — we decide only when the earlier slices are
in use.

---

## Sequencing rationale

- **M1 first** because it delivers the *identity* change (portal, not chat) with
  the least new plumbing — the kanban engine and gateway observability already
  exist; we're building the UI on top.
- **M2 next** because the review/ship loop is where the "one pane of glass"
  promise pays off, and it feeds the observability artifacts M1 introduces.
- **M3 (editor)** is the desktop anchor but is gated on M2 so the files/diffs
  it opens come from real, reviewable work.
- M4/M5 follow only after real usage tells us what actually hurts.

## What's explicitly out of scope (forever)

Multi-user, RBAC, org service catalog, team onboarding, scorecards. Talaria is
a **personal, local-first** power-tool. If it ever grows into a team product,
that's a separate, deliberate decision — not roadmap creep.
