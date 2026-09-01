import { describe, expect, it } from "vitest";
import {
  declaredDispatchInputs,
  buildDispatchInputs,
  serveDeployDispatch,
} from "../../../../apps/pwa/deploy-dispatch.mjs";

// A mock gateway GitHub proxy that records calls and returns canned responses.
function mockProxy(responses: Array<{ ok: boolean; status: number; data?: Record<string, unknown> }>) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  let i = 0;
  const fn = async ({ method, path, body }: { method: string; path: string; body?: unknown }) => {
    calls.push({ method, path, body });
    const r = responses[Math.min(i, responses.length - 1)] ?? { ok: false, status: 404 };
    i += 1;
    return { ok: r.ok, status: r.status, data: r.data ?? {} };
  };
  return { fn, calls };
}

// A minimal IncomingMessage-like object with an async body.
function makeReq(body: unknown, method = "POST") {
  const payload = JSON.stringify(body);
  return {
    method,
    async *[Symbol.asyncIterator]() {
      yield payload;
    },
  };
}

function makeRes() {
  const state = { status: 0, body: "" };
  return {
    state,
    writeHead(status: number) {
      state.status = status;
      return this;
    },
    end(body?: string) {
      state.body = body || "";
      return this;
    },
  };
}

const WORKFLOW_WITH_VERCEL =
  "name: Deploy\n" +
  "on:\n" +
  "  workflow_dispatch:\n" +
  "    inputs:\n" +
  "      environment:\n" +
  "        description: Target\n" +
  "      vercel_token:\n" +
  "        description: Vercel token\n" +
  "        required: true\n" +
  "jobs: {}\n";

const WORKFLOW_NO_INPUT =
  "name: CI\n" +
  "on:\n" +
  "  push:\n" +
  "    branches: [main]\n" +
  "  workflow_dispatch:\n" +
  "jobs: {}\n";

const WORKFLOW_INLINE_DISPATCH = "name: Release\non: workflow_dispatch\njobs: {}\n";

describe("declaredDispatchInputs", () => {
  it("finds inputs declared under workflow_dispatch", () => {
    expect(declaredDispatchInputs(WORKFLOW_WITH_VERCEL)).toContain("vercel_token");
    expect(declaredDispatchInputs(WORKFLOW_WITH_VERCEL)).toContain("environment");
  });

  it("returns [] for a workflow_dispatch with no inputs block", () => {
    expect(declaredDispatchInputs(WORKFLOW_NO_INPUT)).toEqual([]);
  });

  it("returns [] for inline `on: workflow_dispatch`", () => {
    expect(declaredDispatchInputs(WORKFLOW_INLINE_DISPATCH)).toEqual([]);
  });

  it("returns [] for empty / non-YAML text", () => {
    expect(declaredDispatchInputs("")).toEqual([]);
    expect(declaredDispatchInputs("not yaml at all")).toEqual([]);
  });
});

describe("buildDispatchInputs", () => {
  it("injects the key only when the workflow declares vercel_token AND a key is set", () => {
    const out = buildDispatchInputs({ inputs: { environment: "prod" }, yamlText: WORKFLOW_WITH_VERCEL, key: "vk-123" });
    expect(out).toEqual({ environment: "prod", vercel_token: "vk-123" });
  });

  it("does NOT inject when the workflow doesn't declare vercel_token", () => {
    const out = buildDispatchInputs({ inputs: { a: "b" }, yamlText: WORKFLOW_NO_INPUT, key: "vk-123" });
    expect(out).toEqual({ a: "b" });
  });

  it("does NOT inject when no key is set (even if the workflow declares it)", () => {
    const out = buildDispatchInputs({ inputs: { a: "b" }, yamlText: WORKFLOW_WITH_VERCEL, key: null });
    expect(out).toEqual({ a: "b" });
  });

  it("preserves inputs when yaml is unknown (null)", () => {
    const out = buildDispatchInputs({ inputs: { a: "b" }, yamlText: null, key: "vk-123" });
    expect(out).toEqual({ a: "b" });
  });
});

describe("serveDeployDispatch", () => {
  it("rejects a missing body", async () => {
    const { fn } = mockProxy([]);
    const req = { method: "POST", async *[Symbol.asyncIterator]() {} };
    const res = makeRes();
    await serveDeployDispatch(req, res, { githubProxy: fn });
    expect(res.state.status).toBe(400);
  });

  it("injects the stored key and forwards the dispatch when workflow declares vercel_token", async () => {
    // responses: workflow meta -> path, contents -> base64 yaml, dispatch -> 204
    const { fn, calls } = mockProxy([
      { ok: true, status: 200, data: { path: ".github/workflows/deploy.yml" } },
      { ok: true, status: 200, data: { content: Buffer.from(WORKFLOW_WITH_VERCEL).toString("base64") } },
      { ok: true, status: 204 },
    ]);
    const res = makeRes();
    await serveDeployDispatch(
      makeReq({ owner: "o", repo: "r", workflowId: 5, ref: "main", inputs: { environment: "prod" } }),
      res,
      { githubProxy: fn, getKey: () => "vk-secret" }
    );
    expect(res.state.status).toBe(204);
    const dispatchCall = calls.find((c) => c.path.endsWith("/dispatches"));
    expect(dispatchCall?.body).toEqual({
      ref: "main",
      inputs: { environment: "prod", vercel_token: "vk-secret" },
    });
  });

  it("forwards WITHOUT the key when the workflow doesn't declare vercel_token", async () => {
    const { fn, calls } = mockProxy([
      { ok: true, status: 200, data: { path: ".github/workflows/ci.yml" } },
      { ok: true, status: 200, data: { content: Buffer.from(WORKFLOW_NO_INPUT).toString("base64") } },
      { ok: true, status: 204 },
    ]);
    const res = makeRes();
    await serveDeployDispatch(makeReq({ owner: "o", repo: "r", workflowId: 5, ref: "main", inputs: { a: "b" } }), res, {
      githubProxy: fn,
      getKey: () => "vk-secret",
    });
    expect(res.state.status).toBe(204);
    const dispatchCall = calls.find((c) => c.path.endsWith("/dispatches"));
    expect(dispatchCall?.body).toEqual({ ref: "main", inputs: { a: "b" } });
  });

  it("surfaces a GitHub 422 error verbatim", async () => {
    const { fn } = mockProxy([
      { ok: true, status: 200, data: { path: ".github/workflows/deploy.yml" } },
      { ok: true, status: 200, data: { content: Buffer.from(WORKFLOW_WITH_VERCEL).toString("base64") } },
      { ok: false, status: 422, data: { message: "Unexpected input(s)" } },
    ]);
    const res = makeRes();
    await serveDeployDispatch(makeReq({ owner: "o", repo: "r", workflowId: 5, ref: "main", inputs: {} }), res, {
      githubProxy: fn,
      getKey: () => "vk-secret",
    });
    expect(res.state.status).toBe(422);
    expect(JSON.parse(res.state.body).error).toContain("Unexpected input(s)");
  });

  it("dispatches without the key when workflow metadata is unreadable (safe default)", async () => {
    const { fn, calls } = mockProxy([
      { ok: false, status: 404 }, // workflow meta fails
      { ok: true, status: 204 },
    ]);
    const res = makeRes();
    await serveDeployDispatch(makeReq({ owner: "o", repo: "r", workflowId: 5, ref: "main", inputs: { a: "b" } }), res, {
      githubProxy: fn,
      getKey: () => "vk-secret",
    });
    expect(res.state.status).toBe(204);
    const dispatchCall = calls.find((c) => c.path.endsWith("/dispatches"));
    expect(dispatchCall?.body).toEqual({ ref: "main", inputs: { a: "b" } });
  });
});
