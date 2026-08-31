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
} from "../../../../apps/pwa/vercel-key.mjs";

// A temp "Hermes home" so tests never touch the real host secret store.
function makeHome(): string {
  return mkdtempSync(join(tmpdir(), "talaria-vk-"));
}

// Deterministic 32-byte test key (hex = 64 chars).
const TEST_KEY = Buffer.from("0123456789abcdef".repeat(4), "hex");

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
});
