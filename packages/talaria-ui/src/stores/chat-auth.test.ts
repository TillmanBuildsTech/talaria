import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "../db";
import { useChatStore } from "./chat";

// Regression for the profile-chat disconnect (t_15c404e8): every profile agent
// must be provisioned with its OWN per-profile API key (from /talaria-config),
// and agentKey() must return that per-profile key — NOT fall back to the global
// base key — for /p/<profile>/ multiplex routes. Without it the gateway 401s
// profile chats and the UI shows "Offline — Tap to retry".

beforeEach(() => {
  vi.restoreAllMocks();
  useChatStore.setState({
    agents: [],
    apiKey: "global-base-key",
    connectionStatus: "connected",
    error: null,
  });
  // Clear agents table so loadAgents() starts empty.
  return db.agents.clear();
});

describe("profile chat authentication (per-profile keys)", () => {
  it("agentKey returns the profile's own key once provisioned, not the global base key", async () => {
    // Simulate applyServerConfig() having provisioned a real per-profile key
    // for the "developer" profile from /talaria-config.
    await useChatStore.getState().addAgent({
      name: "developer",
      displayName: "Developer",
      apiKey: "dev-profile-key",
    });
    // addAgent calls loadAgents(); ensure state reflects the stored agent.
    await useChatStore.getState().loadAgents();

    const s = useChatStore.getState();
    // The /p/developer/ multiplex route must authenticate with the profile's
    // key, never the global one the gateway rejects on that route.
    expect(s.agentKey("developer")).toBe("dev-profile-key");
    // Fallback (global) key is only for the default /v1 route.
    expect(s.agentKey(null)).toBe("global-base-key");
  });

  it("agentKey falls back to the global key only when a profile has none (no /p/ key to send)", async () => {
    await useChatStore.getState().addAgent({ name: "unprovisioned", displayName: "X" });
    await useChatStore.getState().loadAgents();
    expect(useChatStore.getState().agentKey("unprovisioned")).toBe("global-base-key");
  });
});
