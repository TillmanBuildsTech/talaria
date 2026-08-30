import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentAvatar } from "./agent-avatar";

describe("AgentAvatar", () => {
  it("renders two-letter initials from a multi-word display name", () => {
    render(<AgentAvatar name="product-owner" display="Product Owner" color="#fbbf24" />);
    expect(screen.getByText("PO")).toBeInTheDocument();
  });

  it("falls back to the profile name when no display name is set", () => {
    render(<AgentAvatar name="developer" />);
    expect(screen.getByText("D")).toBeInTheDocument();
  });

  it("uses the name as the title attribute when no display name is set", () => {
    render(<AgentAvatar name="developer" />);
    expect(screen.getByTitle("developer")).toBeInTheDocument();
  });
});
