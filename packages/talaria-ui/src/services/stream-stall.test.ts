import { afterEach, describe, expect, it, vi } from "vitest";
import { hermesClient } from "./hermes";

const realFetch = globalThis.fetch;

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = realFetch;
  hermesClient.abort();
});

// A stream that accepts the request but never yields a chunk — the hung-SSE
// case that used to pin the bubble on "streaming" until an app restart. Like
// a real fetch body, the stream errors with AbortError when the signal fires.
function hangingFetch() {
  return vi.fn(async (_url: unknown, init: { signal?: AbortSignal } = {}) => {
    const stream = new ReadableStream({
      start(c) {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("This operation was aborted");
          err.name = "AbortError";
          try {
            c.error(err);
          } catch {
            /* already closed */
          }
        });
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  });
}

describe("streamChat stall watchdog", () => {
  it("routes a stalled stream into onError (retry ladder) instead of hanging", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const seen: Array<string> = [];
    let done = false;
    await hermesClient.streamChat(
      [{ role: "user", content: "hi" }],
      {
        onToken: (t) => seen.push(t),
        onDone: () => {
          done = true;
        },
        onError: (e) => {
          seen.push(`ERR:${e instanceof Error ? e.message : e}`);
        },
      },
      { stallTimeoutMs: 60 }
    );
    expect(done).toBe(false);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/ERR:.*stall/i);
    expect(hermesClient.stallTimers.size).toBe(0);
  });

  it("does not fire the watchdog when chunks keep flowing", async () => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n'));
        c.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, { status: 200 })));
    const seen: Array<string> = [];
    let done = false;
    await hermesClient.streamChat(
      [{ role: "user", content: "hi" }],
      {
        onToken: (t) => seen.push(t),
        onDone: () => {
          done = true;
        },
        onError: (e) => {
          seen.push(`ERR:${e instanceof Error ? e.message : e}`);
        },
      },
      { stallTimeoutMs: 5_000 }
    );
    expect(seen).toEqual(["hi"]);
    expect(done).toBe(true);
  });
});
