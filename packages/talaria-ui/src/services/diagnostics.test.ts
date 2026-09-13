import { beforeEach, describe, expect, it } from "vitest";

import { DiagnosticsLog, describeError } from "./diagnostics";

// The diagnostics log is the single sink that replaced the chat path's silent
// `catch {}` blocks — these tests pin its contract: always-on info/warn/error,
// debug gated behind verbose, a bounded buffer, and a copyable text dump.

beforeEach(() => {
  window.localStorage.clear();
});

describe("DiagnosticsLog", () => {
  it("records info/warn/error without verbose, but skips debug", () => {
    const log = new DiagnosticsLog();
    log.info("s", "i");
    log.warn("s", "w");
    log.error("s", "e");
    log.debug("s", "d");
    expect(log.snapshot().map((e) => e.level)).toEqual(["info", "warn", "error"]);
  });

  it("records debug entries once verbose mode is on", () => {
    const log = new DiagnosticsLog();
    log.setVerbose(true);
    log.debug("stream.developer", "chunk", { bytes: 12 });
    const debug = log.snapshot().filter((e) => e.level === "debug");
    expect(debug).toHaveLength(1);
    expect(debug[0].data).toEqual({ bytes: 12 });
  });

  it("bounds the buffer so per-chunk logging cannot grow it without limit", () => {
    const log = new DiagnosticsLog();
    for (let i = 0; i < 450; i++) log.info("s", `m${i}`);
    const snap = log.snapshot();
    expect(snap).toHaveLength(400);
    // Oldest 50 evicted; ids keep increasing so drops are detectable.
    expect(snap[0].message).toBe("m50");
    expect(snap[399].message).toBe("m449");
  });

  it("notifies subscribers on record and stops after unsubscribe", () => {
    const log = new DiagnosticsLog();
    let calls = 0;
    const off = log.subscribe(() => calls++);
    log.info("s", "one");
    off();
    log.info("s", "two");
    expect(calls).toBe(1);
    expect(log.snapshot()).toHaveLength(2);
  });

  it("dumps a human-readable log with level, scope, message and data", () => {
    const log = new DiagnosticsLog();
    log.warn("stream.developer", "Turn failed: error", { reason: "boom" });
    const text = log.toText();
    expect(text).toContain("WARN");
    expect(text).toContain("[stream.developer]");
    expect(text).toContain("Turn failed: error");
    expect(text).toContain('"reason":"boom"');
  });

  it("clear empties the buffer", () => {
    const log = new DiagnosticsLog();
    log.error("s", "e");
    log.clear();
    expect(log.snapshot()).toEqual([]);
  });
});

describe("describeError", () => {
  it("reduces an Error to name/message without a giant stack", () => {
    const out = describeError(new TypeError("nope"));
    expect(out.name).toBe("TypeError");
    expect(out.message).toBe("nope");
  });

  it("passes plain objects through as a copy", () => {
    const out = describeError({ status: 401, reason: "bad key" });
    expect(out).toEqual({ status: 401, reason: "bad key" });
  });

  it("stringifies primitives", () => {
    expect(describeError("boom")).toEqual({ message: "boom" });
  });
});
