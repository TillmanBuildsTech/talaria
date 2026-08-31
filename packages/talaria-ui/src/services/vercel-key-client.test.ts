import { describe, expect, it, vi } from "vitest";
import { getVercelKeyConfigured, saveVercelApiKey } from "./vercel-key";

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

  it("PUT sends the apiKey + gateway Bearer auth as JSON and does not require a response body", async () => {
    const fetchImpl = mockFetch(200, { configured: true });
    await expect(saveVercelApiKey("vercel-token-abc", "base-key-123", fetchImpl)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/api/deployments/vercel-key", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: "Bearer base-key-123" },
      body: JSON.stringify({ apiKey: "vercel-token-abc" }),
    });
  });

  it("PUT omits the Authorization header when no auth key is available", async () => {
    const fetchImpl = mockFetch(200, { configured: true });
    await expect(saveVercelApiKey("k", null, fetchImpl)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/api/deployments/vercel-key", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "k" }),
    });
  });

  it("PUT surfaces the server error detail on failure", async () => {
    const fetchImpl = mockFetch(400, { error: "apiKey is required" });
    await expect(saveVercelApiKey("", "k", fetchImpl)).rejects.toThrow(/apiKey is required/);
  });

  it("PUT throws with the HTTP status when the error body is not JSON", async () => {
    const fetchImpl = vi.fn(async () => {
      return { ok: false, status: 503, json: async () => {
        throw new Error("not json");
      } } as unknown as Response;
    }) as unknown as ReturnType<typeof vi.fn> & typeof fetch;
    await expect(saveVercelApiKey("k", "k", fetchImpl)).rejects.toThrow(/HTTP 503/);
  });
});
