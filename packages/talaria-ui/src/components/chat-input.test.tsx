import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Conversation } from "../db";
import { useChatStore } from "../stores/chat";
import { ChatInput } from "./chat-input";

// The chat store's init() talks to the network/gateway — don't call it. We
// seed the store state directly and render ChatInput, whose placeholder is a
// pure function of the active conversation's agentIds + agentDisplay.
function seed(conv: Conversation) {
  useChatStore.setState({
    messages: [],
    conversations: [conv],
    activeConversationId: conv.id ?? null,
    agents: [
      { name: "product-owner", displayName: "Product Owner", color: "#fbbf24", sort: 0 },
      { name: "developer", displayName: "Developer", color: "#38bdf8", sort: 1 },
    ],
    activeStreams: 0,
    connectionStatus: "connected",
    error: null,
  });
}

function conv(partial: Partial<Conversation> & { id: number }): Conversation {
  return {
    title: "Chat",
    lastMessage: "",
    updatedAt: Date.now(),
    kind: "default",
    agentIds: [],
    messageCount: 0,
    ...partial,
  } as Conversation;
}

const renderInput = () =>
  render(<ChatInput onSend={() => {}} onStop={() => {}} />);

beforeEach(() => {
  useChatStore.setState({
    messages: [],
    conversations: [],
    activeConversationId: null,
    activeStreams: 0,
    connectionStatus: "connected",
    error: null,
    agents: [],
  });
});

describe("ChatInput placeholder (profile-aware)", () => {
  it("falls back to Message Hermes for the default profile (no agentIds)", () => {
    seed(conv({ id: 1, kind: "default", agentIds: [] }));
    renderInput();
    expect(screen.getByPlaceholderText("Message Hermes…")).toBeInTheDocument();
  });

  it("names the agent in a DM using its display name", () => {
    seed(conv({ id: 2, kind: "dm", agentIds: ["product-owner"] }));
    renderInput();
    expect(screen.getByPlaceholderText("Message Product Owner…")).toBeInTheDocument();
  });

  it("title-cases the profile name when the agent has no display name", () => {
    // "researcher-a" is not in the seeded agents table → agentDisplay fallback.
    seed(conv({ id: 3, kind: "dm", agentIds: ["researcher-a"] }));
    renderInput();
    expect(screen.getByPlaceholderText("Message Researcher A…")).toBeInTheDocument();
  });

  it("keeps the group placeholder for 2+ member groups", () => {
    seed(conv({ id: 4, kind: "group", agentIds: ["product-owner", "developer"] }));
    renderInput();
    expect(screen.getByPlaceholderText("Message the group (@agent to direct)…")).toBeInTheDocument();
  });

  it("updates the placeholder when switching conversations", () => {
    seed(conv({ id: 5, kind: "default", agentIds: [] }));
    renderInput();
    expect(screen.getByPlaceholderText("Message Hermes…")).toBeInTheDocument();

    // Switch to a DM — the placeholder must react to the store change.
    act(() => {
      useChatStore.setState({
        conversations: [
          conv({ id: 5, kind: "default", agentIds: [] }),
          conv({ id: 6, kind: "dm", agentIds: ["developer"] }),
        ],
        activeConversationId: 6,
      });
    });
    expect(screen.getByPlaceholderText("Message Developer…")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Message Hermes…")).not.toBeInTheDocument();

    // And back to a group.
    act(() => {
      useChatStore.setState({
        conversations: [
          conv({ id: 5, kind: "default", agentIds: [] }),
          conv({ id: 7, kind: "group", agentIds: ["product-owner", "developer"] }),
        ],
        activeConversationId: 7,
      });
    });
    expect(screen.getByPlaceholderText("Message the group (@agent to direct)…")).toBeInTheDocument();
  });
});

describe("agentDisplay default-profile handling", () => {
  it("returns null when no agent is selected (default profile)", () => {
    seed(conv({ id: 1, kind: "default", agentIds: [] }));
    const { agentDisplay } = useChatStore.getState();
    expect(agentDisplay(null)).toBeNull();
    expect(agentDisplay(undefined)).toBeNull();
  });

  it("maps a known agent to its display name", () => {
    seed(conv({ id: 2, kind: "dm", agentIds: ["product-owner"] }));
    expect(useChatStore.getState().agentDisplay("product-owner")).toBe("Product Owner");
  });

  it("title-cases an unknown profile name", () => {
    seed(conv({ id: 2, kind: "dm", agentIds: ["product-owner"] }));
    expect(useChatStore.getState().agentDisplay("quality-assurance")).toBe("Quality Assurance");
  });
});
