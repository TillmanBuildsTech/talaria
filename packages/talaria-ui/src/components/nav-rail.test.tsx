import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NavRail, type NavEntry } from "./nav-rail";

const entries: Array<NavEntry> = [
  { id: "chat", label: "Chat", icon: <span>chat-icon</span> },
  { id: "repos", label: "Repos", icon: <span>repo-icon</span> },
  { id: "settings", label: "Settings", icon: <span>settings-icon</span>, footer: true },
];

describe("NavRail", () => {
  it("renders main entries before the footer spacer", () => {
    const { container } = render(<NavRail active="chat" onSelect={() => {}} entries={entries} />);
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Chat", "Repos", "Settings"]);
    // The spacer div (flex-1) must sit between the last main entry and the footer entry.
    const spacer = container.querySelector(".flex-1");
    expect(spacer).not.toBeNull();
    const settingsButton = screen.getByRole("button", { name: "Settings" });
    // Footer entries come after the spacer, so the spacer precedes the settings button.
    expect(spacer!.compareDocumentPosition(settingsButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("marks footer entries last and renders them without disabling", () => {
    const { container } = render(<NavRail active="chat" onSelect={() => {}} entries={entries} />);
    const buttons = Array.from(container.querySelectorAll("button"));
    const settings = buttons[buttons.length - 1];
    expect(settings.getAttribute("aria-label")).toBe("Settings");
    expect(settings.hasAttribute("disabled")).toBe(false);
  });
});
