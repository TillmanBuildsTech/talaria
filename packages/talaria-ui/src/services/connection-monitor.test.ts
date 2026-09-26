import { afterEach, describe, expect, it, vi } from "vitest";
import { createConnectionMonitor } from "./hermes";

// healthCheck() fetches a relative URL, which throws under jsdom/undici, so
// the real fetch always reports unhealthy here — stub it for the healthy path.
const realFetch = globalThis.fetch;

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = realFetch;
});

describe("createConnectionMonitor presence", () => {
  it("stays silent while healthy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
    const events: Array<string> = [];
    const m = createConnectionMonitor({
      onOnline: () => events.push("online"),
      onReconnecting: () => events.push("reconnecting"),
      onOffline: () => events.push("offline"),
    });
    expect(await m.checkNow()).toBe(true);
    expect(events).toEqual([]);
    m.destroy();
  });

  it("fires reconnecting on the first failed check, offline at the threshold, online on recovery", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    const events: Array<string> = [];
    const m = createConnectionMonitor(
      {
        onOnline: () => events.push("online"),
        onReconnecting: () => events.push("reconnecting"),
        onOffline: () => events.push("offline"),
      },
      { unhealthyThreshold: 3 }
    );
    expect(await m.checkNow()).toBe(false);
    expect(events).toEqual(["reconnecting"]);
    expect(await m.checkNow()).toBe(false);
    expect(events).toEqual(["reconnecting"]); // no repeat event on 2nd failure
    expect(await m.checkNow()).toBe(false);
    expect(events).toEqual(["reconnecting", "offline"]);
    // Further failures stay offline (no event spam).
    expect(await m.checkNow()).toBe(false);
    expect(events).toEqual(["reconnecting", "offline"]);
    // Recovery fires online exactly once.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
    expect(await m.checkNow()).toBe(true);
    expect(events).toEqual(["reconnecting", "offline", "online"]);
    m.destroy();
  });

  it("browser offline event goes offline immediately; online re-verifies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    const events: Array<string> = [];
    const m = createConnectionMonitor({
      onOnline: () => events.push("online"),
      onReconnecting: () => events.push("reconnecting"),
      onOffline: () => events.push("offline"),
    });
    window.dispatchEvent(new Event("offline"));
    expect(events).toEqual(["offline"]);
    window.dispatchEvent(new Event("online"));
    // online resets + fires online, then the immediate re-check fails → reconnecting
    await new Promise((r) => setTimeout(r, 20));
    expect(events[0]).toBe("offline");
    expect(events).toContain("online");
    m.destroy();
  });
});
