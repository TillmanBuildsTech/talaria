import "./lib/styles/globals.css";

export { App } from "./app";
export { AgentAvatar } from "./components/agent-avatar";
export { ChatInput } from "./components/chat-input";
export { ChatMessage } from "./components/chat-message";
export { ConnectionBanner } from "./components/connection-banner";
export { ConversationBadge } from "./components/conversation-badge";
export { GitHubConnect } from "./components/github-connect";
export { SettingsModal } from "./components/settings-modal";
export { Sidebar } from "./components/sidebar";
export type { Agent, ChatMessage as ChatMessageRecord, Conversation, ConversationKind, GitHubConnection, GitHubConnectionStatus, GitHubConnectionType, MessageStatus, Setting } from "./db";
export { default as db } from "./db";
export { KNOWN_MODELS, knownWindowFor } from "./models";
export type { ModelInfo } from "./models";
export { createConnectionMonitor, hermesClient } from "./services/hermes";
export type { ConnectionMonitorCallbacks, SessionRecord, SessionSummary, StreamCallbacks, StreamMessage, StreamOptions, StreamUsage } from "./services/hermes";
export {
  DirectGitHubTransport,
  GatewayGitHubTransport,
  GitHubClient,
  GITHUB_CLIENT_ID,
  GITHUB_DEVICE_SCOPE,
  githubClient,
} from "./services/github";
export type {
  DeviceFlowHandle,
  DevicePollResult,
  GitHubRequestOpts,
  GitHubResponse,
  GitHubTransport,
  GitHubTransportKind,
} from "./services/github";
export type { ChatState, ConnectionStatus, SlashCommand } from "./stores/chat";
export { useChatStore } from "./stores/chat";
export type { DeviceFlowState, GitHubState } from "./stores/github";
export { useGitHubStore } from "./stores/github";
