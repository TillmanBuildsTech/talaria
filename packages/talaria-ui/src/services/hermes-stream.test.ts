import { afterEach, describe, expect, it, vi } from "vitest";

import { StreamError, hermesClient } from "./hermes";
import type { StreamCallbacks, ToolProgress } from "./hermes";

// Stream-failure contract: the gateway reports a failed turn INSIDE the SSE
// body (finish_reason "error"/"length" + an error message) and still sends
// [DONE]. The client must surface the gateway's own reason — never render a
// failed turn as a successful empty reply, and never retry non-retriable kinds.
//
// The skill's hard rule for stream mocks: they must honor the abort signal, or
// watchdog tests time out instead of testing anything.

const enc = new TextEncoder();

type ChunkReader = {
  read: () => Promise<{ done: boolean; value?: Uint8Array }>;
};

function chunkReader(frames: Array<string>): ChunkReader {
  const bytes = frames.map((f) => enc.encode(f));
  let i = 0;
  return {
    read: async () => {
      if (i >= bytes.length) return { done: true };
      const value = bytes[i++];
      return { done: false, value };
    },
  };
}

// A stream that never yields: the stall watchdog must abort it. Honors the
// abort signal so the test resolves instead of hanging.
function hangingReader(signal?: AbortSignal): ChunkReader {
  const abortError = () => Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
  return {
    read: () =>
      new Promise<{ done: boolean; value?: Uint8Array }>((_resolve, reject) => {
        if (signal?.aborted) {
          reject(abortError());
          return;
        }
        signal?.addEventListener("abort", () => reject(abortError()));
      }),
  };
}

function okResponse(reader: ChunkReader): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: (_name: string): string | null => null },
    body: { getReader: () => reader },
  } as unknown as Response;
}

function errorResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    headers: { get: (_name: string): string | null => null },
    text: async () => body,
  } as unknown as Response;
}

function stubFetch(impl: (url: unknown, init?: RequestInit) => unknown): void {
  vi.stubGlobal("fetch", vi.fn(impl) as unknown as typeof fetch);
}

function collect() {
  const tokens: Array<string> = [];
  const errors: Array<unknown> = [];
  const toolLines: Array<ToolProgress> = [];
  let dones = 0;
  const callbacks: StreamCallbacks = {
    onToken: (t) => tokens.push(t),
    onDone: () => {
      dones++;
    },
    onError: (e) => {
      errors.push(e);
    },
    onToolProgress: (p) => {
      toolLines.push(p);
    },
  };
  return { tokens, errors, toolLines, get dones() {
    return dones;
  }, callbacks };
}

afterEach(() => {
  vi.unstubAllGlobals();
  hermesClient.abort();
});

describe("streamChat failure visibility", () => {
  it("surfaces the gateway's own message when a turn fails mid-stream", async () => {
    stubFetch(async () =>
      okResponse(
        chunkReader([
          'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"error"}],"error":{"message":"provider exploded","type":"provider_error"}}\n\n',
          "data: [DONE]\n\n",
        ])
      )
    );
    const c = collect();
    await hermesClient.streamChat([{ role: "user", content: "hi" }], c.callbacks, { label: "test" });
    expect(c.dones).toBe(0);
    expect(c.errors).toHaveLength(1);
    const err = c.errors[0] as StreamError;
    expect(err).toBeInstanceOf(StreamError);
    expect(err.kind).toBe("agent-error");
    expect(err.message).toContain("provider exploded");
    expect(err.retriable).toBe(true);
    expect(err.partial).toBe("partial");
    expect(c.tokens).toEqual(["partial"]);
  });

  it("maps finish_reason length to a non-retriable truncation", async () => {
    stubFetch(async () =>
      okResponse(chunkReader(['data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n', "data: [DONE]\n\n"]))
    );
    const c = collect();
    await hermesClient.streamChat([{ role: "user", content: "hi" }], c.callbacks, { label: "test" });
    const err = c.errors[0] as StreamError;
    expect(err.kind).toBe("truncated");
    expect(err.retriable).toBe(false);
    expect(c.dones).toBe(0);
  });

  it("maps HTTP 401 to a non-retriable auth error with the gateway's text", async () => {
    stubFetch(async () => errorResponse(401, '{"error":{"message":"Invalid gateway API key","code":"gateway_auth_failed"}}'));
    const c = collect();
    await hermesClient.streamChat([{ role: "user", content: "hi" }], c.callbacks, { label: "test" });
    const err = c.errors[0] as StreamError;
    expect(err.kind).toBe("auth");
    expect(err.retriable).toBe(false);
    expect(err.message).toContain("API key");
  });

  it("maps HTTP 500 to a retriable server error", async () => {
    stubFetch(async () => errorResponse(500, "upstream exploded"));
    const c = collect();
    await hermesClient.streamChat([{ role: "user", content: "hi" }], c.callbacks, { label: "test" });
    const err = c.errors[0] as StreamError;
    expect(err.kind).toBe("server");
    expect(err.retriable).toBe(true);
  });

  it("treats a stream that ends without [DONE] as truncated", async () => {
    stubFetch(async () =>
      okResponse(chunkReader(['data: {"choices":[{"delta":{"content":"half a reply"},"finish_reason":null}]}\n\n']))
    );
    const c = collect();
    await hermesClient.streamChat([{ role: "user", content: "hi" }], c.callbacks, { label: "test" });
    const err = c.errors[0] as StreamError;
    expect(err.kind).toBe("truncated");
    expect(err.partial).toBe("half a reply");
    expect(c.dones).toBe(0);
  });

  it("forwards tool-progress frames so long turns render live activity", async () => {
    stubFetch(async () =>
      okResponse(
        chunkReader([
          'data: {"tool":"terminal","emoji":"⌨","label":"ls -la","toolCallId":"t1","status":"running"}\n\n',
          'data: {"choices":[{"delta":{"content":"done"},"finish_reason":null}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
          "data: [DONE]\n\n",
        ])
      )
    );
    const c = collect();
    await hermesClient.streamChat([{ role: "user", content: "hi" }], c.callbacks, { label: "test" });
    expect(c.toolLines).toEqual([{ tool: "terminal", emoji: "⌨", label: "ls -la", toolCallId: "t1", status: "running" }]);
    expect(c.dones).toBe(1);
    expect(c.errors).toHaveLength(0);
  });

  it("reports a stall when the stream goes silent past the watchdog", async () => {
    stubFetch(async (_url, init) => okResponse(hangingReader(init?.signal as AbortSignal | undefined)));
    const c = collect();
    await hermesClient.streamChat([{ role: "user", content: "hi" }], c.callbacks, {
      label: "test",
      stallTimeoutMs: 50,
      firstByteTimeoutMs: 5000,
    });
    expect(c.errors).toHaveLength(1);
    const err = c.errors[0] as StreamError;
    expect(err.kind).toBe("stall");
    expect(err.retriable).toBe(true);
  });
});
