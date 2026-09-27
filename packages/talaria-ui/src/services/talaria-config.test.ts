import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildTalariaConfig,
  hermesHomeRoot,
  readApiServerKey,
  readProfileModel,
} from "../../../../apps/pwa/talaria-config.mjs";

// Fixture: a fake Hermes home with a base .env + two profiles (keys + model).
function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "talaria-cfg-"));
  writeFileSync(join(dir, ".env"), "API_SERVER_KEY=base-key-123\n");
  for (const [name, key, model, provider] of [
    ["dev", "dev-key-abc", "deepseek/deepseek-chat", "deepseek"],
    ["ops", "ops-key-def", "anthropic/claude-sonnet-4-5", "anthropic"],
  ] as Array<[string, string, string, string]>) {
    const pd = join(dir, "profiles", name);
    mkdirSync(pd, { recursive: true });
    writeFileSync(join(pd, ".env"), `API_SERVER_KEY=${key}\n`);
    writeFileSync(
      join(pd, "config.yaml"),
      `model:\n  default: "${model}"\n  provider: ${provider}\n  context_length: 200000\n`
    );
  }
  return dir;
}

describe("talaria-config shared module", () => {
  it("hermesHomeRoot unwraps a profile-scoped HERMES_HOME to the parent root", () => {
    expect(hermesHomeRoot({ HERMES_HOME: "/root/.hermes/profiles/developer" })).toBe("/root/.hermes");
    expect(hermesHomeRoot({ HERMES_HOME: "/root/.hermes" })).toBe("/root/.hermes");
    expect(hermesHomeRoot({ HERMES_HOME: "" })).toBe("/root/.hermes");
  });

  it("readApiServerKey trims quotes and finds API_SERVER_KEY", () => {
    const dir = mkdtempSync(join(tmpdir(), "talaria-key-"));
    writeFileSync(join(dir, ".env"), 'FOO=1\nAPI_SERVER_KEY="quoted-key"\n');
    expect(readApiServerKey(join(dir, ".env"))).toBe("quoted-key");
    rmSync(dir, { recursive: true, force: true });
  });

  it("readProfileModel parses the model block with provider + context_length", () => {
    const dir = mkdtempSync(join(tmpdir(), "talaria-model-"));
    mkdirSync(join(dir, "profiles", "dev"), { recursive: true });
    writeFileSync(
      join(dir, "profiles", "dev", "config.yaml"),
      'model:\n  default: "deepseek/deepseek-chat"\n  provider: deepseek\n  context_length: 200000\n'
    );
    expect(readProfileModel(join(dir, "profiles", "dev"))).toEqual({
      model: "deepseek/deepseek-chat",
      provider: "deepseek",
      contextLength: 200000,
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it("buildTalariaConfig reads the real base key and every profile's per-profile key", () => {
    const dir = makeFixture();
    const cfg = buildTalariaConfig({ home: dir, env: {} });
    expect(cfg.base).toBe("base-key-123");
    // Every profile present in profiles/ gets its OWN key (the root fix: no
    // fallback to the global key for /p/<profile>/ routes).
    expect(cfg.agents).toEqual({ dev: "dev-key-abc", ops: "ops-key-def" });
    expect(cfg.models.dev.model).toBe("deepseek/deepseek-chat");
    expect(cfg.models.dev.provider).toBe("deepseek");
    expect(cfg.models.dev.contextLength).toBe(200000);
    rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to TALARIA_AGENT_KEYS env when host profile dirs are absent (container)", () => {
    const dir = mkdtempSync(join(tmpdir(), "talaria-ctr-"));
    writeFileSync(join(dir, ".env"), "API_SERVER_KEY=base-key-123\n");
    const cfg = buildTalariaConfig({
      home: dir,
      env: { TALARIA_BASE_KEY: "base-from-env", TALARIA_AGENT_KEYS: '{"dev":"dev-from-env"}' },
    });
    expect(cfg.base).toBe("base-key-123"); // real base wins over env when present
    expect(cfg.agents).toEqual({ dev: "dev-from-env" });
    rmSync(dir, { recursive: true, force: true });
  });
});
