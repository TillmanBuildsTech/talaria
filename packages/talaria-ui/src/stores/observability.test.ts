import { beforeEach, describe, expect, it } from "vitest";
import db, { type ActivityEvent } from "../db";
import { isArtifactBacked, isReviewable, useObservabilityStore } from "./observability";

function makeEvent(partial: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    agent: "developer",
    projectId: null,
    kind: "action",
    action: "test",
    status: "done",
    createdAt: Date.now(),
    ...partial,
  };
}

beforeEach(async () => {
  await db.activity.clear();
  useObservabilityStore.getState().reset();
});

describe("isArtifactBacked (P3 gate)", () => {
  it("requires a linkable artifact for a done claim", () => {
    expect(isArtifactBacked(makeEvent({ status: "done", artifact: null }))).toBe(false);
    expect(
      isArtifactBacked(makeEvent({ status: "done", artifact: { kind: "commit", title: "abc", url: "https://github.com/x/y/commit/abc" } }))
    ).toBe(true);
  });

  it("does not trust a bare ref without a url", () => {
    expect(isArtifactBacked(makeEvent({ status: "done", artifact: { kind: "branch", title: "wt/foo", ref: "wt/foo" } }))).toBe(false);
  });

  it("running and failed states are not claims, so they pass (no false 'done')", () => {
    expect(isArtifactBacked(makeEvent({ status: "running" }))).toBe(true);
    expect(isArtifactBacked(makeEvent({ status: "failed" }))).toBe(true);
  });

  it("is false for null/undefined", () => {
    expect(isArtifactBacked(null)).toBe(false);
    expect(isArtifactBacked(undefined)).toBe(false);
  });
});

describe("isReviewable", () => {
  it("true only when a diff is attached", () => {
    expect(isReviewable(makeEvent({ diff: "diff --git a/x b/x" }))).toBe(true);
    expect(isReviewable(makeEvent({ diff: null }))).toBe(false);
    expect(isReviewable(makeEvent({ diff: "" }))).toBe(false);
  });
});

describe("useObservabilityStore", () => {
  it("records an event to Dexie and live-appends to the feed", async () => {
    const s = useObservabilityStore.getState();
    const ev = await s.record({
      agent: "developer",
      kind: "tool",
      action: "ran tests",
      tool: "terminal",
      output: "PASS",
    });
    expect(ev.id).toBeTruthy();
    expect(useObservabilityStore.getState().events[0].agent).toBe("developer");
    // Persisted locally (P5).
    const stored = await db.activity.get(ev.id as number);
    expect(stored?.tool).toBe("terminal");
  });

  it("loads history filtered by agent", async () => {
    const s = useObservabilityStore.getState();
    await s.record({ agent: "developer", kind: "action", action: "push" });
    await s.record({ agent: "researcher", kind: "action", action: "search" });
    await s.load({ agent: "developer" });
    const events = useObservabilityStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0].agent).toBe("developer");
  });

  it("loads history filtered by task scope", async () => {
    const s = useObservabilityStore.getState();
    await s.record({ agent: "developer", kind: "action", action: "push", taskId: "t-1" });
    await s.record({ agent: "developer", kind: "action", action: "push", taskId: "t-2" });
    await s.load({ taskId: "t-1" });
    expect(useObservabilityStore.getState().events).toHaveLength(1);
  });

  it("scopes events by project and filters by project (P9)", async () => {
    const s = useObservabilityStore.getState();
    await s.record({ agent: "developer", kind: "action", action: "a", projectId: "proj-1" });
    await s.record({ agent: "developer", kind: "action", action: "b", projectId: "proj-2" });
    await s.load({ projectId: "proj-1" });
    const events = useObservabilityStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0].projectId).toBe("proj-1");
  });

  it("update() patches an event and the in-memory feed", async () => {
    const s = useObservabilityStore.getState();
    const ev = await s.record({ agent: "developer", kind: "action", action: "push" });
    await s.update(ev.id as number, {
      status: "done",
      artifact: { kind: "commit", title: "abc", url: "https://github.com/x/y/commit/abc" },
    });
    const updated = useObservabilityStore.getState().events.find((e) => e.id === ev.id);
    expect(updated?.status).toBe("done");
    expect(isArtifactBacked(updated)).toBe(true);
  });

  it("review() records a human-gate verdict (P2)", async () => {
    const s = useObservabilityStore.getState();
    const ev = await s.record({
      agent: "developer",
      kind: "review",
      action: "implemented feature",
      diff: "diff --git a/x b/x\n+line",
      status: "running",
    });
    await s.review(ev.id as number, "approved");
    const updated = useObservabilityStore.getState().events.find((e) => e.id === ev.id);
    expect(updated?.reviewVerdict).toBe("approved");
    expect(updated?.status).toBe("done");
  });

  it("clear() wipes events (all scopes or a project scope)", async () => {
    const s = useObservabilityStore.getState();
    await s.record({ agent: "developer", kind: "action", action: "a", projectId: "proj-1" });
    await s.record({ agent: "developer", kind: "action", action: "b", projectId: null });
    await s.clear("proj-1");
    expect(useObservabilityStore.getState().events).toHaveLength(1);
    expect(useObservabilityStore.getState().events[0].projectId).toBeNull();
  });

  it("applies active filters from state in load()", async () => {
    const s = useObservabilityStore.getState();
    await s.record({ agent: "developer", kind: "tool", action: "x", tool: "terminal" });
    await s.record({ agent: "developer", kind: "action", action: "y" });
    s.setKindFilter("tool");
    await s.load({});
    const events = useObservabilityStore.getState().events;
    expect(events.every((e) => e.kind === "tool")).toBe(true);
  });
});
