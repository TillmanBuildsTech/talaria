# Agent Observability — Seeing What Your Agents Actually Do

Observability is what turns Talaria from "a chat you have to trust" into "a
dev tool you can trust." Agents are **first-class collaborators whose work is
visible and reviewable** (P3). You should never have to take an agent's word
that something happened — you should be able to **see it**, and verify it
against a real artifact.

## What "observability" means here

Not metrics dashboards. Talaria surfaces the **actual work** of each agent,
connected to the **actual artifacts** it produces:

- **Live activity** — what the agent is doing right now.
- **History** — what it has done, in order, replayable.
- **Tool output** — the real result of what it ran (a diff, a test run, a
  branch, a PR, a deployment).
- **Artifacts** — the concrete, verifiable outcomes: commit SHA, branch name,
  open PR URL, deployment ID.

## The core rule (P3 acceptance)

> **No claim of completed work is accepted by the UI without a linkable
> artifact proving it.**

Concretely: when an agent says "I pushed the fix," the UI shows the branch and
commit. When it says "PR is open," the UI links the PR. When it says "it's
deployed," the UI links the deployment. A bare "done" in a chat bubble is not
done — the observability layer is the difference.

This directly encodes the hard-won lesson that "agent said it" is not "it
happened": the only trustworthy signal is a commit on a real branch, an open PR,
or a live deployment — verifiable outside the agent's own report.

## What gets surfaced

| Layer | What you see |
|---|---|
| **Activity feed** | Global, live stream of every agent's actions + tool calls, filterable by agent/task/time. |
| **Per-agent timeline** | Everything one agent has done, in order; drill into any step. |
| **Task-scoped view** | All activity belonging to one kanban task, start → finish. |
| **Artifacts** | Branches, commits, PRs, CI runs, deployments an agent produced, linked & verifiable. |
| **Diffs** | The actual code changes, rendered for review before you approve. |
| **Logs/output** | Raw tool output where useful (test output, build logs). |

## Streaming

Like the existing chat SSE streaming, observability is **live**: the activity
feed updates as agents work, in the background, without you polling. You can
watch a swarm execute in real time, or leave the tab and return to a complete
replayable timeline.

## Review & gating

Observability feeds the human gate (P2). When an agent finishes a task, the
work lands in a **Review** state with its diff attached:

- **Approve** — the PR/branch/deploy proceeds (respecting the repo's real
  gates per P1).
- **Request changes** — comment lands back to the responsible agent.
- **Reject / re-scope** — the task returns with context.

The portal never bypasses the repo's actual constraints; it surfaces them so
your approval means the same thing it means on GitHub (protected branch, required
checks, squash-only merge — whatever the repo enforces).

## Trust model summary

- **Chat** tells you what an agent *intends*.
- **Observability** shows you what it *does*.
- **Artifacts** prove what *actually happened*, outside the agent's report.

The product is built so the last layer is always reachable in one click.

## What the user gets

- See everything your agents are doing, live and replayable, from one screen.
- Review actual diffs and artifacts, not chat summaries.
- Approve work with confidence because "done" is backed by proof.
