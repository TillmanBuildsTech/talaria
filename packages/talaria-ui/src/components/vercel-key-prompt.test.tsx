import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VercelKeyPrompt } from "./vercel-key-prompt";

function renderPrompt(overrides: Partial<Parameters<typeof VercelKeyPrompt>[0]> = {}) {
  const props = {
    updating: false,
    busy: false,
    error: null,
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  return { props, view: render(<VercelKeyPrompt {...props} />) };
}

describe("VercelKeyPrompt", () => {
  it("renders the required-key headline in first-time mode", () => {
    renderPrompt();
    expect(screen.getByText(/Vercel API key required/i)).toBeInTheDocument();
  });

  it("renders the update headline when updating an existing key", () => {
    renderPrompt({ updating: true });
    expect(screen.getByText(/Update Vercel API key/i)).toBeInTheDocument();
  });

  it("calls onSave with the trimmed key on submit", () => {
    const { props } = renderPrompt();
    fireEvent.change(screen.getByPlaceholderText(/Paste Vercel API key/i), {
      target: { value: "  vercel-token-xyz  " },
    });
    fireEvent.click(screen.getByText(/Save & continue/i));
    expect(props.onSave).toHaveBeenCalledWith("vercel-token-xyz");
  });

  it("does not call onSave when the input is empty", () => {
    const { props } = renderPrompt();
    fireEvent.change(screen.getByPlaceholderText(/Paste Vercel API key/i), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByText(/Save & continue/i));
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("does not call onSave while busy (avoid duplicate submissions)", () => {
    const { props } = renderPrompt({ busy: true });
    fireEvent.change(screen.getByPlaceholderText(/Paste Vercel API key/i), {
      target: { value: "key" },
    });
    fireEvent.click(screen.getByText(/Saving…/i));
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("submits on Enter and shows the busy label while saving", () => {
    const { props } = renderPrompt();
    const input = screen.getByPlaceholderText(/Paste Vercel API key/i);
    fireEvent.change(input, { target: { value: "key" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onSave).toHaveBeenCalledWith("key");
  });

  it("shows the error message", () => {
    renderPrompt({ error: "Could not save Vercel API key" });
    expect(screen.getByText(/Could not save Vercel API key/i)).toBeInTheDocument();
  });

  it("calls onCancel when cancel is clicked", () => {
    const { props } = renderPrompt();
    fireEvent.click(screen.getByText(/Cancel/i));
    expect(props.onCancel).toHaveBeenCalled();
  });
});
