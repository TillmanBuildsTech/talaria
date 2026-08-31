import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  encryptSecret,
  decryptSecret,
  getVercelApiKey,
  setVercelApiKey,
  vercelKeyConfigured,
  hermesHomeRoot,
  serveVercelKey,
  vercelKeyWriteAuthorized,
} from "../../../../apps/pwa/vercel-key.mjs";

// A temp "Hermes home" so tests never touch the real host secret store.
function makeHome(): string {
  return mkdtempSync(join(tmpdir(), "talaria-vk-"));
}

// Deterministic 32-byte test key (hex = 64 chars).
const TEST_KEY = Buffer.from("0123456789abcdef".repeat(4), "hex");

// Build a mock node:http IncomingMessage for serveVercelKey. `body` is pushed
// as the async-iterable body (serveVercelKey reads it for PUT).
function mockReq(method: string, headers: Record<string, string>, body?: string) {
  const req: any = { method, headers: headers ?? {} };
  req[Symbol.asyncIterator] = async function* () {
    if (body) yield body;
  };
  return req;
}

// Collect a mock ServerResponse's status + JSON body.
function mockRes() {
  const out: { status: number; body: unknown; headers: Record<string, string> } = {
    status: 200,
    body: null,
    headers: {},
  };
  const res: any = {
    writeHead(status: number, headers: Record<string, string>) {
      out.status = status;
      out.headers = headers ?? {};
      return res;
    },
    end(json?: string) {
      if (typeof json === "string") {
        try {
          out.body = JSON.parse(json);
        } catch {
          out.body = json;
        }
      }
      return res;
    },
  };
  return { res, out };
}

describe("vercel-key shared module", () => {
  it("hermesHomeRoot unwraps a profile-scoped HERMES_HOME to the parent root", () => {
    expect(hermesHomeRoot({ HERMES_HOME: "/root/.hermes/profiles/developer" })).toBe("/root/.hermes");
    expect(hermesHomeRoot({ HERMES_HOME: "/root/.hermes" })).toBe("/root/.hermes");
    expect(hermesHomeRoot({ HERMES_HOME: "" })).toBe("/root/.hermes");
  });

  it("encryptSecret/decryptSecret round-trip the plaintext", () => {
    const bundle = encryptSecret(TEST_KEY, "vercel-token-abc123");
    expect(bundle.data).not.toContain("vercel-token-abc123"); // never plaintext in the payload
    expect(decryptSecret(TEST_KEY, bundle)).toBe("vercel-token-abc123");
  });

  it("decryptSecret throws on a tampered ciphertext (GCM auth tag)", () => {
    const bundle = encryptSecret(TEST_KEY, "secret");
    const tampered = { ...bundle, data: Buffer.from("tampered", "utf8").toString("base64") };
    expect(() => decryptSecret(TEST_KEY, tampered)).toThrow();
  });

  it("is not configured until a key is set, then configured, and the raw key is readable server-side", () => {
    const home = makeHome();
    expect(vercelKeyConfigured({ home })).toBe(false);
    expect(getVercelApiKey({ home })).toBeNull();
    setVercelApiKey("vercel-token-xyz", { home });
    expect(vercelKeyConfigured({ home })).toBe(true);
    // Server-side read returns the full key (deployment code), never exposed to browser.
    expect(getVercelApiKey({ home })).toBe("vercel-token-xyz");
    rmSync(home, { recursive: true, force: true });
  });

  it("persists encrypted-at-rest: the on-disk payload never contains the plaintext", () => {
    const home = makeHome();
    setVercelApiKey("super-secret-token", { home });
    const payload = readFileSync(join(home, "talaria", "vercel-key.json"), "utf8");
    expect(payload).not.toContain("super-secret-token");
    rmSync(home, { recursive: true, force: true });
  });

  it("setVercelApiKey replaces an existing key", () => {
    const home = makeHome();
    setVercelApiKey("first", { home });
    setVercelApiKey("second", { home });
    expect(getVercelApiKey({ home })).toBe("second");
    rmSync(home, { recursive: true, force: true });
  });

  it("setVercelApiKey rejects a blank key", () => {
    const home = makeHome();
    expect(() => setVercelApiKey("   ", { home })).toThrow("apiKey is required");
    expect(() => setVercelApiKey("", { home })).toThrow("apiKey is required");
    rmSync(home, { recursive: true, force: true });
  });

  it("master key file is created with 0600 perms", () => {
    const home = makeHome();
    setVercelApiKey("token", { home });
    const keyPath = join(home, "talaria", ".master.key");
    expect(readFileSync(keyPath, "utf8").length).toBeGreaterThan(0);
    const stat = statSync(keyPath);
    expect(stat.mode & 0o777).toBe(0o600);
    rmSync(home, { recursive: true, force: true });
  });

  // ── Write auth (SEC-F2) ──────────────────────────────────────────────────
  // The PUT overwrites a stored credential, so it must reject unauth'd writes.

  const AUTH_ENV = { TALARIA_BASE_KEY: "base-key-123" };

  // An isolated home with no .env → the env TALARIA_BASE_KEY fallback is the
  // expected write key (mirrors the container-deployment auth path).
  const authHome = () => {
    const h = makeHome();
    return { home: h, env: AUTH_ENV };
  };

  it("vercelKeyWriteAuthorized accepts a Bearer key matching the base key", () => {
    const { home, env } = authHome();
    expect(
      vercelKeyWriteAuthorized(
        { headers: { authorization: "Bearer base-key-123" } },
        { home, env }
      )
    ).toBe(true);
    rmSync(home, { recursive: true, force: true });
  });

  it("vercelKeyWriteAuthorized rejects missing / malformed / wrong auth", () => {
    const { home, env } = authHome();
    const opts = { home, env };
    expect(vercelKeyWriteAuthorized({ headers: {} }, opts)).toBe(false);
    expect(vercelKeyWriteAuthorized({ headers: { authorization: "" } }, opts)).toBe(false);
    expect(vercelKeyWriteAuthorized({ headers: { authorization: "Basic abc" } }, opts)).toBe(false);
    expect(vercelKeyWriteAuthorized({ headers: { authorization: "Bearer wrong-key" } }, opts)).toBe(false);
    expect(vercelKeyWriteAuthorized({ headers: { authorization: "base-key-123" } }, opts)).toBe(false);
    rmSync(home, { recursive: true, force: true });
  });

  it("vercelKeyWriteAuthorized rejects when no base key is configured", () => {
    const h = makeHome();
    expect(
      vercelKeyWriteAuthorized(
        { headers: { authorization: "Bearer anything" } },
        { home: h, env: {} }
      )
    ).toBe(false);
    rmSync(h, { recursive: true, force: true });
  });

  it("serveVercelKey PUT is rejected with 401 when unauthenticated", async () => {
    const home = makeHome();
    const { res, out } = mockRes();
    await serveVercelKey(
      mockReq("PUT", { "Content-Type": "application/json" }, JSON.stringify({ apiKey: "vercel-xyz" })),
      res,
      { home, env: AUTH_ENV }
    );
    expect(out.status).toBe(401);
    expect((out.body as any).error).toBe("unauthorized");
    // Nothing was stored.
    expect(getVercelApiKey({ home })).toBeNull();
    rmSync(home, { recursive: true, force: true });
  });

  it("serveVercelKey PUT is rejected with 401 when authenticated with a wrong key", async () => {
    const home = makeHome();
    const { res, out } = mockRes();
    await serveVercelKey(
      mockReq("PUT", { authorization: "Bearer wrong", "Content-Type": "application/json" }, JSON.stringify({ apiKey: "vercel-xyz" })),
      res,
      { home, env: AUTH_ENV }
    );
    expect(out.status).toBe(401);
    expect(getVercelApiKey({ home })).toBeNull();
    rmSync(home, { recursive: true, force: true });
  });

  it("serveVercelKey PUT succeeds with a valid Bearer key and never echoes it", async () => {
    const home = makeHome();
    const { res, out } = mockRes();
    await serveVercelKey(
      mockReq("PUT", { authorization: "Bearer base-key-123", "Content-Type": "application/json" }, JSON.stringify({ apiKey: "vercel-xyz" })),
      res,
      { home, env: AUTH_ENV }
    );
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ configured: true });
    // Stored server-side; response never contains the raw key.
    expect(getVercelApiKey({ home })).toBe("vercel-xyz");
    expect(JSON.stringify(out.body)).not.toContain("vercel-xyz");
    rmSync(home, { recursive: true, force: true });
  });

  it("serveVercelKey GET stays open and returns only { configured }", async () => {
    const home = makeHome();
    setVercelApiKey("vercel-xyz", { home });
    const { res, out } = mockRes();
    await serveVercelKey(mockReq("GET", {}), res, { home, env: AUTH_ENV });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ configured: true });
    expect(JSON.stringify(out.body)).not.toContain("vercel-xyz");
    rmSync(home, { recursive: true, force: true });
  });
});
