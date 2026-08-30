import { create } from "zustand";
import db, { type GitHubConnection, type GitHubConnectionType } from "../db";
import { hermesClient } from "../services/hermes";
import {
  DirectGitHubTransport,
  GatewayGitHubTransport,
  githubClient,
  type DeviceFlowHandle,
} from "../services/github";

// Detect the desktop (Tauri) shell at runtime. The desktop shell does the
// device-flow exchange natively (direct transport); the web/PWA routes through
// the user's own Hermes gateway (gateway transport).
function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type DeviceFlowState = {
  active: boolean;
  handle: DeviceFlowHandle | null;
  error: string | null;
  polling: boolean;
};

export type GitHubState = {
  connections: Array<GitHubConnection>;
  deviceFlow: DeviceFlowState;
  platform: "desktop" | "web";

  init: () => Promise<void>;
  loadConnections: () => Promise<void>;
  transportKind: () => "direct" | "gateway";

  // Device flow
  startDeviceFlow: () => Promise<void>;
  stopDeviceFlow: () => void;
  pollDeviceFlow: () => Promise<void>;

  // PAT fallback
  connectWithPat: (token: string) => Promise<void>;

  // Token lifecycle
  disconnect: (owner: string) => Promise<void>;
  markReconnecting: (owner: string) => Promise<void>;
};

// Web keeps only an opaque token_ref (the gateway holds the token); desktop
// holds the raw token locally keyed by owner.
const tokenSettingsKey = (owner: string) => `github:token:${owner}`;

export const useGitHubStore = create<GitHubState>((set, get) => ({
  connections: [],
  deviceFlow: { active: false, handle: null, error: null, polling: false },
  platform: isDesktop() ? "desktop" : "web",

  async init() {
    // Configure the transport for this shell.
    if (get().platform === "desktop") {
      githubClient.setTransport(new DirectGitHubTransport());
    } else {
      githubClient.setTransport(
        new GatewayGitHubTransport(hermesClient.gatewayRoot(), hermesClient.apiKey)
      );
    }
    await get().loadConnections();
  },

  async loadConnections() {
    const connections = await db.connections.toArray();
    set({ connections });
  },

  transportKind: () => (get().platform === "desktop" ? "direct" : "gateway"),

  async startDeviceFlow() {
    set({ deviceFlow: { active: true, handle: null, error: null, polling: false } });
    try {
      const handle = await githubClient.connectDeviceFlow();
      set({ deviceFlow: { active: true, handle, error: null, polling: false } });
    } catch (err) {
      set({
        deviceFlow: {
          active: true,
          handle: null,
          error: err instanceof Error ? err.message : "Could not start GitHub device flow",
          polling: false,
        },
      });
    }
  },

  stopDeviceFlow() {
    set({ deviceFlow: { active: false, handle: null, error: null, polling: false } });
  },

  async pollDeviceFlow() {
    const { handle } = get().deviceFlow;
    if (!handle || !handle.device_code) return;
    set({ deviceFlow: { ...get().deviceFlow, polling: true, error: null } });
    try {
      const result = await githubClient.pollDeviceFlow(handle.device_code);
      if (result.status === "success") {
        // Desktop: the app received the token directly.
        if (result.access_token) {
          githubClient.setToken(result.access_token);
        } else if (result.token_ref) {
          githubClient.tokenRef = result.token_ref;
        }
        // Verify and persist the connection.
        const { login } = await githubClient.verifyConnection();
        const type: GitHubConnectionType = "device";
        const gatewayOrigin =
          get().platform === "desktop" ? "" : hermesClient.gatewayRoot();
        const tokenRef =
          get().platform === "desktop"
            ? tokenSettingsKey(login)
            : result.token_ref || "";
        if (get().platform === "desktop" && result.access_token) {
          await db.settings.put({ key: tokenSettingsKey(login), value: result.access_token });
        }
        const now = Date.now();
        await db.connections.put({
          id: login,
          owner: login,
          type,
          status: "connected",
          scopes: [],
          tokenRef,
          gatewayOrigin,
          lastVerifiedAt: now,
          connectedAt: now,
        });
        await get().loadConnections();
        set({ deviceFlow: { active: false, handle: null, error: null, polling: false } });
        return;
      }
      if (result.status === "denied" || result.status === "expired") {
        set({
          deviceFlow: {
            ...get().deviceFlow,
            polling: false,
            error: result.status === "denied" ? "Authorization denied." : "Device code expired. Start again.",
          },
        });
        return;
      }
      // pending — keep polling
      set({ deviceFlow: { ...get().deviceFlow, polling: false } });
    } catch (err) {
      set({
        deviceFlow: {
          ...get().deviceFlow,
          polling: false,
          error: err instanceof Error ? err.message : "Polling failed",
        },
      });
    }
  },

  async connectWithPat(token) {
    const trimmed = (token || "").trim();
    if (!trimmed) throw new Error("Paste a token first");
    // Verify against GitHub before storing anything.
    const { login } = await githubClient.verifyConnection(trimmed);
    const gatewayOrigin = get().platform === "desktop" ? "" : hermesClient.gatewayRoot();
    const tokenRef = tokenSettingsKey(login);
    // Store the token locally (Dexie settings) — on the user's machine, never
    // on a Talaria server. On web the request path routes through the gateway
    // proxy, which reads the token it holds; the browser keeps only the ref.
    await db.settings.put({ key: tokenRef, value: trimmed });
    const now = Date.now();
    await db.connections.put({
      id: login,
      owner: login,
      type: "pat",
      status: "connected",
      scopes: [],
      tokenRef,
      gatewayOrigin,
      lastVerifiedAt: now,
      connectedAt: now,
    });
    await get().loadConnections();
  },

  async disconnect(owner) {
    const conn = await db.connections.get(owner);
    if (conn) {
      await db.settings.delete(conn.tokenRef).catch(() => {});
    }
    await db.connections.delete(owner);
    await get().loadConnections();
  },

  async markReconnecting(owner) {
    await db.connections.update(owner, { status: "reconnecting" });
    await get().loadConnections();
  },
}));
