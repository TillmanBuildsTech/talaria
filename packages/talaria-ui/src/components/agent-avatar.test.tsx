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

  it("renders a role badge with the role label when a role is given", () => {
    render(<AgentAvatar name="product-owner" display="Product Owner" color="#fbbf24" role="ceo" />);
    expect(screen.getByLabelText("Role: ceo")).toBeInTheDocument();
    expect(screen.getByTitle("Product Owner — ceo")).toBeInTheDocument();
  });

  it("renders no role badge when no role is given", () => {
    render(<AgentAvatar name="comedian" display="Comedian" color="#f472b6" />);
    expect(screen.queryByLabelText(/Role:/)).not.toBeInTheDocument();
  });
});
