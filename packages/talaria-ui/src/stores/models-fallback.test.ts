import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "./chat";

// The model dropdown blends three sources: the gated KNOWN catalog, each
// profile's configured default (modelsMap), and every profile's
// fallback_providers (fallbackModels, ungated). Same model id on different
// providers must appear as distinct rows with their own override pair.

beforeEach(() => {
  useChatStore.setState({
    modelsMap: {},
    fallbackModels: [],
    availableModelProviders: [],
    conversations: [],
    activeConversationId: null,
  });
});

describe("configuredModels blending", () => {
  it("offers fallback models even when their provider lacks credentials (ungated)", () => {
    useChatStore.setState({
      availableModelProviders: ["openrouter"],
      fallbackModels: [{ model: "openrouter/free", provider: "opencode-go", contextLength: null }],
    });
    const rows = useChatStore.getState().configuredModels();
    expect(rows.find((m) => m.model === "openrouter/free" && m.provider === "opencode-go")).toBeTruthy();
  });

  it("keeps the same model id on different providers as distinct rows", () => {
    useChatStore.setState({
      modelsMap: {
        a: { model: "deepseek-v4-flash", provider: "deepseek", contextLength: null },
        b: { model: "deepseek-v4-flash", provider: "opencode-go", contextLength: null },
      },
    });
    const rows = useChatStore.getState().configuredModels().filter((m) => m.model === "deepseek-v4-flash");
    expect(rows.map((m) => m.provider).sort()).toEqual(["deepseek", "opencode-go"]);
  });
});

describe("model+provider override pairing", () => {
  it("activeModelProvider returns the provider stored with the override", () => {
    useChatStore.setState({
      conversations: [
        {
          id: 1,
          title: "t",
          lastMessage: "",
          updatedAt: 0,
          kind: "default",
          agentIds: [],
          model: "deepseek-v4-flash",
          modelProvider: "opencode-go",
        },
      ],
      activeConversationId: 1,
    });
    expect(useChatStore.getState().activeModelName()).toBe("deepseek-v4-flash");
    expect(useChatStore.getState().activeModelProvider()).toBe("opencode-go");
  });

  it("activeModelProvider is null when using the profile default", () => {
    useChatStore.setState({
      conversations: [
        { id: 1, title: "t", lastMessage: "", updatedAt: 0, kind: "default", agentIds: [] },
      ],
      activeConversationId: 1,
    });
    expect(useChatStore.getState().activeModelProvider()).toBeNull();
  });
});
