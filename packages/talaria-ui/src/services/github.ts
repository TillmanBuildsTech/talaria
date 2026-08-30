// GitHub client — M2 auth (architecture.md "Connecting to GitHub").
//
// Two supported connection mechanisms:
//   1. OAuth Device Flow with a public Client ID only (no secret, no central
//      server) — the "Login with GitHub" button, same mechanism as `gh`.
//   2. Fine-grained PAT pasted in Settings (fallback, zero infra).
//
// Transport abstraction (P6 — one shared brain, both shells equal):
//   direct   — desktop (Tauri): the app calls GitHub's endpoints natively.
//              No CORS restriction. Token lives in the OS keychain / local.
//   gateway  — web (PWA): the browser cannot poll GitHub's OAuth token endpoint
//              (no CORS headers), so the token exchange and REST proxy are
//              routed through the user's OWN Hermes gateway (their machine).
//              The browser only ever holds an opaque token_ref — never the raw
//              token. Local-first (P5): no Talaria-hosted cloud.
//
// The resulting token never leaves the user's machine/gateway.

// GitHub OAuth device endpoints
const GITHUB_DEVICE_URL = "https://github.com/login/device/code";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_URL = "https://api.github.com";

// The product registers ONE GitHub OAuth App and embeds only its PUBLIC Client
// ID. No Client Secret is ever stored or shipped. Overridable per build via
// `__GITHUB_CLIENT_ID__` (Vite define) for deployments that register their own.
const DEFAULT_GITHUB_CLIENT_ID = "Iv1.0x00000000000000"; // placeholder — replace with the registered app's Client ID

export const GITHUB_CLIENT_ID: string =
  typeof __GITHUB_CLIENT_ID__ !== "undefined" && __GITHUB_CLIENT_ID__
    ? __GITHUB_CLIENT_ID__
    : DEFAULT_GITHUB_CLIENT_ID;

// Scopes requested on device flow: repo + workflow cover the M2 module needs
// (repos/PRs/CI/deploys). Fine-grained tokens carry their own scoped grants.
export const GITHUB_DEVICE_SCOPE = "repo workflow";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DeviceFlowHandle = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

export type DevicePollResult =
  | { status: "pending" }
  | { status: "success"; access_token?: string; token_ref?: string }
  | { status: "denied" }
  | { status: "expired" };

export type GitHubRequestOpts = {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string; // GitHub API path, always starts with "/"
  body?: unknown;
};

export type GitHubResponse<T> = {
  status: number;
  ok: boolean;
  data: T;
};

export type GitHubTransportKind = "direct" | "gateway";

// A transport knows HOW to reach GitHub (direct vs. through the user's
// gateway), including the device-flow exchange and token storage.
export interface GitHubTransport {
  readonly kind: GitHubTransportKind;
  startDeviceFlow(clientId: string): Promise<DeviceFlowHandle>;
  pollDeviceFlow(clientId: string, deviceCode: string): Promise<DevicePollResult>;
  request<T>(opts: GitHubRequestOpts, token?: string | null): Promise<GitHubResponse<T>>;
}

// ---------------------------------------------------------------------------
// Direct transport (desktop / Tauri) — native HTTP, no CORS.
// ---------------------------------------------------------------------------

export class DirectGitHubTransport implements GitHubTransport {
  readonly kind: "direct" = "direct";

  constructor(private fetchImpl: typeof fetch = fetch) {}

  async startDeviceFlow(clientId: string): Promise<DeviceFlowHandle> {
    const body = new URLSearchParams({
      client_id: clientId,
      scope: GITHUB_DEVICE_SCOPE,
    });
    const res = await this.fetchImpl(GITHUB_DEVICE_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new Error(`GitHub device code HTTP ${res.status}: ${await res.text().catch(() => "")}`);
    }
    const data = await res.json();
    return {
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: data.verification_uri || "https://github.com/login/device",
      expires_in: data.expires_in || 900,
      interval: data.interval || 5,
    };
  }

  async pollDeviceFlow(clientId: string, deviceCode: string): Promise<DevicePollResult> {
    const body = new URLSearchParams({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    const res = await this.fetchImpl(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (res.status === 200) {
      const data = await res.json();
      if (data.access_token) {
        return { status: "success", access_token: data.access_token };
      }
      return { status: "pending" };
    }
    const data = await res.json().catch(() => ({}));
    switch (data.error) {
      case "authorization_pending":
        return { status: "pending" };
      case "slow_down":
        return { status: "pending" };
      case "expired_token":
        return { status: "expired" };
      case "access_denied":
        return { status: "denied" };
      default:
        return { status: "denied" };
    }
  }

  async request<T>(opts: GitHubRequestOpts, token?: string | null): Promise<GitHubResponse<T>> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    const res = await this.fetchImpl(`${GITHUB_API_URL}${opts.path}`, {
      method: opts.method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let data: T;
    try {
      data = (await res.json()) as T;
    } catch {
      data = {} as T;
    }
    return { status: res.status, ok: res.ok, data };
  }
}

// ---------------------------------------------------------------------------
// Gateway transport (web / PWA) — routed through the user's own Hermes gateway.
// ---------------------------------------------------------------------------

export class GatewayGitHubTransport implements GitHubTransport {
  readonly kind: "gateway" = "gateway";

  // origin: the gateway root (e.g. http://localhost:8642 or "" for same-origin
  // via the Vite/serve proxy). apiKey: the existing API_SERVER_KEY the PWA
  // already uses for chat — the gateway's device-flow + proxy endpoints ride
  // the same trust.
  constructor(
    public origin: string,
    public apiKey: string | null,
    private fetchImpl: typeof fetch = fetch
  ) {}

  private async gatewayPost<T>(path: string, body: unknown): Promise<GitHubResponse<T>> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const res = await this.fetchImpl(`${this.origin}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T;
    return { status: res.status, ok: res.ok, data };
  }

  async startDeviceFlow(clientId: string): Promise<DeviceFlowHandle> {
    const { ok, status, data } = await this.gatewayPost<Partial<DeviceFlowHandle>>(
      "/api/v1/github/device/start",
      { clientId }
    );
    if (!ok) {
      throw new Error(`Gateway device start HTTP ${status}`);
    }
    return {
      device_code: data.device_code || "",
      user_code: data.user_code || "",
      verification_uri: data.verification_uri || "https://github.com/login/device",
      expires_in: data.expires_in || 900,
      interval: data.interval || 5,
    };
  }

  async pollDeviceFlow(clientId: string, deviceCode: string): Promise<DevicePollResult> {
    const { ok, data } = await this.gatewayPost<Record<string, string>>(
      "/api/v1/github/device/poll",
      { clientId, device_code: deviceCode }
    );
    if (!ok) return { status: "denied" };
    const st = data.status;
    if (st === "success") return { status: "success", token_ref: data.token_ref };
    if (st === "expired") return { status: "expired" };
    if (st === "denied") return { status: "denied" };
    return { status: "pending" };
  }

  async request<T>(opts: GitHubRequestOpts, _token?: string | null): Promise<GitHubResponse<T>> {
    // The gateway attaches the stored token server-side; the browser never
    // sends a raw GitHub token. The gateway validates `path` against an
    // allowlist so it stays a narrow proxy, not an open relay.
    return this.gatewayPost<T>("/api/v1/github/proxy", {
      method: opts.method,
      path: opts.path,
      body: opts.body,
    });
  }
}

// ---------------------------------------------------------------------------
// GitHubClient — the shared service both shells use.
// ---------------------------------------------------------------------------

export class GitHubClient {
  transport: GitHubTransport;
  // The active direct token (desktop). On web the gateway holds the token and
  // we only keep an opaque tokenRef.
  token: string | null = null;
  tokenRef: string | null = null;

  constructor(transport?: GitHubTransport) {
    this.transport = transport ?? new DirectGitHubTransport();
  }

  setTransport(transport: GitHubTransport) {
    this.transport = transport;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  // Start device flow — returns a handle the UI shows (code + verification URI).
  async connectDeviceFlow(): Promise<DeviceFlowHandle> {
    return this.transport.startDeviceFlow(GITHUB_CLIENT_ID);
  }

  // Poll the device flow until the user authorizes (or the flow expires/denies).
  // Returns the raw poll result; on direct success the caller calls setToken
  // with access_token; on gateway success it records token_ref.
  async pollDeviceFlow(deviceCode: string): Promise<DevicePollResult> {
    return this.transport.pollDeviceFlow(GITHUB_CLIENT_ID, deviceCode);
  }

  // Verify the connection is live — GET /user returns the login.
  async verifyConnection(tokenOverride?: string | null): Promise<{ login: string; scopes: Array<string> }> {
    const token = tokenOverride !== undefined ? tokenOverride : this.token;
    const r = await this.transport.request<{ login?: string; message?: string }>(
      { method: "GET", path: "/user" },
      token
    );
    if (!r.ok || !r.data.login) {
      const msg = (r.data as { message?: string }).message || `HTTP ${r.status}`;
      throw new Error(msg);
    }
    return { login: r.data.login, scopes: [] };
  }

  // Generic request — used by the repos/PRs/CI/deploys modules (children).
  async request<T>(opts: GitHubRequestOpts): Promise<GitHubResponse<T>> {
    return this.transport.request<T>(opts, this.token);
  }
}

export const githubClient = new GitHubClient();
