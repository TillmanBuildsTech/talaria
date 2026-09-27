import { describe, expect, it } from "vitest";
import { ROLE_LABELS, ROLE_ORDER, inferRole } from "./db";

describe("inferRole (CEO mode org chart)", () => {
  it("maps known Hermes profile names to their org roles", () => {
    expect(inferRole("developer")).toBe("coder");
    expect(inferRole("researcher")).toBe("research");
    expect(inferRole("operations")).toBe("ops");
    expect(inferRole("quality-assurance")).toBe("qa");
    expect(inferRole("product-owner")).toBe("ceo");
  });

  it("accepts case variations and synonyms", () => {
    expect(inferRole("Developer")).toBe("coder");
    expect(inferRole("QA")).toBe("qa");
    expect(inferRole("OPERATOR")).toBe("ops");
    expect(inferRole("engineer")).toBe("coder");
  });

  it("returns undefined for unrecognized agents", () => {
    expect(inferRole("comedian")).toBeUndefined();
    expect(inferRole("")).toBeUndefined();
  });
});

describe("role ordering (renders CEOs first)", () => {
  it("places ceo at the front of the display order", () => {
    expect(ROLE_ORDER[0]).toBe("ceo");
    expect(ROLE_ORDER).toEqual(["ceo", "coder", "qa", "research", "ops"]);
  });

  it("labels every role for the sidebar chips", () => {
    for (const role of ROLE_ORDER) {
      expect(ROLE_LABELS[role].length).toBeGreaterThan(0);
    }
    expect(ROLE_LABELS.ceo).toBe("CEO");
  });
});