import { describe, expect, it } from "vitest";
import { deploymentOutcome, deploymentStatusText } from "./deployments";
import type { Deployment } from "../db";

function dep(partial: Partial<Deployment>): Deployment {
  return {
    id: "o/r:1",
    repoId: "o/r",
    owner: "o",
    repo: "r",
    runId: 1,
    workflow: "Deploy",
    workflowDisplay: "Deploy production",
    ref: "main",
    inputs: {},
    headSha: "",
    status: "queued",
    conclusion: null,
    triggeredAt: 0,
    url: "https://github.com/o/r/actions/runs/1",
    project: null,
    ...partial,
  };
}

describe("Deployments — status mapping (workflow-spec §8)", () => {
  it("maps queued/in_progress/completed to display text", () => {
    expect(deploymentStatusText(dep({ status: "queued" }))).toBe("queued");
    expect(deploymentStatusText(dep({ status: "in_progress" }))).toBe("in progress");
    expect(deploymentStatusText(dep({ status: "completed", conclusion: "success" }))).toBe("success");
    expect(deploymentStatusText(dep({ status: "completed", conclusion: null }))).toBe("completed");
  });

  it("outcome is pending while running, pass on success/skipped/neutral, fail otherwise", () => {
    expect(deploymentOutcome(dep({ status: "in_progress" }))).toBe("pending");
    expect(deploymentOutcome(dep({ status: "completed", conclusion: "success" }))).toBe("pass");
    expect(deploymentOutcome(dep({ status: "completed", conclusion: "skipped" }))).toBe("pass");
    expect(deploymentOutcome(dep({ status: "completed", conclusion: "neutral" }))).toBe("pass");
    expect(deploymentOutcome(dep({ status: "completed", conclusion: "failure" }))).toBe("fail");
    expect(deploymentOutcome(dep({ status: "completed", conclusion: "timed_out" }))).toBe("fail");
    expect(deploymentOutcome(dep({ status: "completed", conclusion: "cancelled" }))).toBe("fail");
  });
});
