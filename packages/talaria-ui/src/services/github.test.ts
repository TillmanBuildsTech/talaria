import { describe, expect, it, vi } from "vitest";
import {
  DirectGitHubTransport,
  GatewayGitHubTransport,
  GitHubClient,
  GITHUB_CLIENT_ID,
} from "./github";

// A minimal fetch mock returning a canned Response-like object.
function mockFetch(response: {
  status?: number;
  body?: unknown;
}): ReturnType<typeof vi.fn> & typeof fetch {
  return vi.fn(async () => {
    return {
      ok: (response.status ?? 200) < 400,
      status: response.status ?? 200,
      json: async () => response.body ?? {},
      text: async () => JSON.stringify(response.body ?? {}),
    } as unknown as Response;
  }) as unknown as ReturnType<typeof vi.fn> & typeof fetch;
}

function callArgs(mock: ReturnType<typeof vi.fn> & typeof fetch, i = 0): [string, RequestInit] {
  return mock.mock.calls[i] as [string, RequestInit];
}

describe("DirectGitHubTransport (desktop)", () => {
  it("starts a device flow and returns the handle", async () => {
    const fetchMock = mockFetch({
      body: {
        device_code: "dc-123",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      },
    });
    const t = new DirectGitHubTransport(fetchMock);
    const h = await t.startDeviceFlow(GITHUB_CLIENT_ID);
    expect(h.device_code).toBe("dc-123");
    expect(h.user_code).toBe("ABCD-1234");
    expect(h.interval).toBe(5);
    // The request encodes the public client id + scope, never a secret.
    const [url, init] = callArgs(fetchMock);
    expect(url).toContain("github.com/login/device/code");
    expect(String(init.body)).toContain(`client_id=${GITHUB_CLIENT_ID}`);
    expect(String(init.body)).toContain("scope=repo");
  });

  it("returns success once the user authorizes", async () => {
    const fetchMock = mockFetch({
      body: { access_token: "gho_123", token_type: "bearer", scope: "repo" },
    });
    const t = new DirectGitHubTransport(fetchMock);
    const r = await t.pollDeviceFlow(GITHUB_CLIENT_ID, "dc-123");
    expect(r.status).toBe("success");
    if (r.status === "success") expect(r.access_token).toBe("gho_123");
  });

  it("keeps polling on authorization_pending and maps denied/expired", async () => {
    const pending = new DirectGitHubTransport(mockFetch({ status: 400, body: { error: "authorization_pending" } }));
    expect((await pending.pollDeviceFlow("c", "d")).status).toBe("pending");

    const denied = new DirectGitHubTransport(mockFetch({ status: 400, body: { error: "access_denied" } }));
    expect((await denied.pollDeviceFlow("c", "d")).status).toBe("denied");

    const expired = new DirectGitHubTransport(mockFetch({ status: 400, body: { error: "expired_token" } }));
    expect((await expired.pollDeviceFlow("c", "d")).status).toBe("expired");
  });

  it("attaches the bearer token and GitHub API headers on requests", async () => {
    const fetchMock = mockFetch({ body: { login: "tillmanbuildstech" } });
    const t = new DirectGitHubTransport(fetchMock);
    const r = await t.request<{ login: string }>({ method: "GET", path: "/user" }, "gho_secret");
    expect(r.ok).toBe(true);
    expect(r.data.login).toBe("tillmanbuildstech");
    const [url, init] = callArgs(fetchMock);
    expect(url).toBe("https://api.github.com/user");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer gho_secret");
    expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });
});

describe("GatewayGitHubTransport (web / PWA)", () => {
  it("routes the device flow through the user's gateway", async () => {
    const fetchMock = mockFetch({
      body: {
        device_code: "dc-gw",
        user_code: "WXYZ-9876",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      },
    });
    const t = new GatewayGitHubTransport("http://localhost:8642", "api-key-123", fetchMock);
    const h = await t.startDeviceFlow(GITHUB_CLIENT_ID);
    expect(h.device_code).toBe("dc-gw");
    const [url, init] = callArgs(fetchMock);
    expect(url).toBe("http://localhost:8642/api/v1/github/device/start");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer api-key-123");
    expect(JSON.parse(String(init.body)).clientId).toBe(GITHUB_CLIENT_ID);
  });

  it("returns a token_ref (never a raw token) on gateway success", async () => {
    const fetchMock = mockFetch({ body: { status: "success", token_ref: "gw-ref-42" } });
    const t = new GatewayGitHubTransport("", "key", fetchMock);
    const r = await t.pollDeviceFlow(GITHUB_CLIENT_ID, "dc-gw");
    expect(r.status).toBe("success");
    if (r.status === "success") {
      expect(r.token_ref).toBe("gw-ref-42");
      expect(r.access_token).toBeUndefined();
    }
  });

  it("proxies GitHub REST through the gateway (browser never sends a raw token)", async () => {
    const fetchMock = mockFetch({ body: [{ name: "main" }] });
    const t = new GatewayGitHubTransport("http://gw:8642", "key", fetchMock);
    const r = await t.request<Array<{ name: string }>>({ method: "GET", path: "/repos/o/r/branches" });
    expect(r.data[0].name).toBe("main");
    const [url, init] = callArgs(fetchMock);
    expect(url).toBe("http://gw:8642/api/v1/github/proxy");
    const body = JSON.parse(String(init.body));
    expect(body.method).toBe("GET");
    expect(body.path).toBe("/repos/o/r/branches");
    expect(body.body).toBeUndefined();
  });
});

describe("GitHubClient", () => {
  it("verifyConnection resolves the login for a valid token", async () => {
    const t = new DirectGitHubTransport(mockFetch({ body: { login: "tillmanbuildstech" } }));
    const client = new GitHubClient(t);
    const { login } = await client.verifyConnection("gho_valid");
    expect(login).toBe("tillmanbuildstech");
  });

  it("throws on a bad/revoked token (401)", async () => {
    const t = new DirectGitHubTransport(mockFetch({ status: 401, body: { message: "Bad credentials" } }));
    const client = new GitHubClient(t);
    await expect(client.verifyConnection("gho_bad")).rejects.toThrow(/Bad credentials/);
  });

  it("selects direct by default and can switch to gateway", async () => {
    const client = new GitHubClient(new DirectGitHubTransport(mockFetch({ body: {} })));
    expect(client.transport.kind).toBe("direct");
    const gw = new GatewayGitHubTransport("", null);
    client.setTransport(gw);
    expect(client.transport.kind).toBe("gateway");
  });
});
