import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CodeEditor } from "./code-editor";

// On web (jsdom — no __TAURI_INTERNALS__) the editor capability defaults to
// unavailable, so the shared module must render a clear desktop-only
// affordance instead of breaking (P6). This is the web-surface acceptance case.
describe("CodeEditor web surface (M3 — desktop-only affordance)", () => {
  it("renders the desktop-only affordance on web without attempting file IO", () => {
    render(<CodeEditor />);
    expect(screen.getByText("Code editor is desktop-only")).toBeInTheDocument();
    expect(screen.getByText(/Talaria desktop app/)).toBeInTheDocument();
  });
});
