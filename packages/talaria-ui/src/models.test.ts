import { describe, expect, it } from "vitest";
import { KNOWN_MODELS, knownWindowFor } from "./models";

describe("model catalog (KNOWN_MODELS)", () => {
  it("is non-empty and every entry is well-formed", () => {
    expect(KNOWN_MODELS.length).toBeGreaterThan(0);
    for (const m of KNOWN_MODELS) {
      // vendor/model slug, e.g. deepseek/deepseek-v4-flash or nvidia/...:free
      expect(m.model, "model field").toMatch(/^[a-z0-9-]+\/[a-z0-9._:+-]+$/i);
      expect(m.provider, "provider").toBe("openrouter");
      expect(typeof m.contextLength, "contextLength").toBe("number");
      expect(m.contextLength, "contextLength").toBeGreaterThan(0);
    }
  });

  it("has no duplicate model slugs", () => {
    const slugs = KNOWN_MODELS.map((m) => m.model);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("knownWindowFor", () => {
  it("returns the configured context window for a known model", () => {
    expect(knownWindowFor("deepseek/deepseek-v4-flash")).toBe(128_000);
    expect(knownWindowFor("openai/gpt-5")).toBe(128_000);
  });

  it("falls back to null for unknown, empty, or missing models", () => {
    expect(knownWindowFor("nope/nothing")).toBeNull();
    expect(knownWindowFor("")).toBeNull();
    expect(knownWindowFor(undefined)).toBeNull();
    expect(knownWindowFor(null)).toBeNull();
  });

  it("is consistent with the catalog", () => {
    for (const m of KNOWN_MODELS) {
      expect(knownWindowFor(m.model)).toBe(m.contextLength);
    }
  });
});
