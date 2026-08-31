import { describe, expect, it, vi } from "vitest";
import { getVercelKeyConfigured, saveVercelApiKey, dispatchDeploymentViaServer } from "./vercel-key";

// A fetch stub returning a JSON body with the given status.
function mockFetch(status: number, body: unknown): ReturnType<typeof vi.fn> & typeof fetch {
  return vi.fn(async () => {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as unknown as ReturnType<typeof vi.fn> & typeof fetch;
}

function mockErrorFetch(): ReturnType<typeof vi.fn> & typeof fetch {
  return vi.fn(async () => {
    throw new Error("network down");
  }) as unknown as ReturnType<typeof vi.fn> & typeof fetch;
}

describe("vercel-key client", () => {
  it("GET reports true when the server says configured", async () => {
    const fetchImpl = mockFetch(200, { configured: true });
    await expect(getVercelKeyConfigured(fetchImpl)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith("/api/deployments/vercel-key", { method: "GET" });
  });

  it("GET reports false when the server says not configured", async () => {
    const fetchImpl = mockFetch(200, { configured: false });
    await expect(getVercelKeyConfigured(fetchImpl)).resolves.toBe(false);
  });

  it("GET throws on a non-OK status", async () => {
    const fetchImpl = mockFetch(500, { error: "boom" });
    await expect(getVercelKeyConfigured(fetchImpl)).rejects.toThrow(/HTTP 500/);
  });

  it("GET propagates network failures", async () => {
    await expect(getVercelKeyConfigured(mockErrorFetch())).rejects.toThrow("network down");
  });

  it("PUT sends the apiKey as JSON and does not require a response body", async () => {
    const fetchImpl = mockFetch(200, { configured: true });
    await expect(saveVercelApiKey("vercel-token-abc", fetchImpl)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/api/deployments/vercel-key", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "vercel-token-abc" }),
    });
  });

  it("PUT surfaces the server error detail on failure", async () => {
    const fetchImpl = mockFetch(400, { error: "apiKey is required" });
    await expect(saveVercelApiKey("", fetchImpl)).rejects.toThrow(/apiKey is required/);
  });

  it("PUT throws with the HTTP status when the error body is not JSON", async () => {
    const fetchImpl = vi.fn(async () => {
      return { ok: false, status: 503, json: async () => {
        throw new Error("not json");
      } } as unknown as Response;
    }) as unknown as ReturnType<typeof vi.fn> & typeof fetch;
    await expect(saveVercelApiKey("k", fetchImpl)).rejects.toThrow(/HTTP 503/);
  });

  describe("dispatchDeploymentViaServer", () => {
    it("POSTs the dispatch params to the server endpoint and forwards the gateway API key", async () => {
      const fetchImpl = vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) } as Response));
      await dispatchDeploymentViaServer(
        { owner: "o", repo: "r", workflowId: 7, ref: "main", inputs: { env: "prod" } },
        "gw-key-abc",
        fetchImpl
      );
      expect(fetchImpl).toHaveBeenCalledWith("/api/deployments/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer gw-key-abc" },
        body: JSON.stringify({ owner: "o", repo: "r", workflowId: 7, ref: "main", inputs: { env: "prod" } }),
      });
    });

    it("omits the Authorization header when no API key is set", async () => {
      const fetchImpl = vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) } as Response));
      await dispatchDeploymentViaServer(
        { owner: "o", repo: "r", workflowId: 7, ref: "main" },
        null,
        fetchImpl
      );
      const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(call.headers.Authorization).toBeUndefined();
    });

    it("resolves on a 204 and throws on a GitHub 422 with the detail", async () => {
      const ok = vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) } as Response));
      await expect(
        dispatchDeploymentViaServer({ owner: "o", repo: "r", workflowId: 1, ref: "main" }, null, ok)
      ).resolves.toBeUndefined();

      const err = vi.fn(async () => ({
        ok: false,
        status: 422,
        json: async () => ({ error: "Unexpected input(s) 'vercel_token'" }),
      } as unknown as Response));
      await expect(
        dispatchDeploymentViaServer({ owner: "o", repo: "r", workflowId: 1, ref: "main" }, null, err)
      ).rejects.toThrow(/HTTP 422/);
      await expect(
        dispatchDeploymentViaServer({ owner: "o", repo: "r", workflowId: 1, ref: "main" }, null, err)
      ).rejects.toThrow(/Unexpected input/);
    });
  });
});
