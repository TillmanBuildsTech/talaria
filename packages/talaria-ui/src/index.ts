import "./lib/styles/globals.css";

export { App } from "./app";
export { AgentAvatar } from "./components/agent-avatar";
export { ChatInput } from "./components/chat-input";
export { ChatMessage } from "./components/chat-message";
export { ConnectionBanner } from "./components/connection-banner";
export { ConversationBadge } from "./components/conversation-badge";
export { DiffViewer } from "./components/diff-viewer";
export { GitHubConnect } from "./components/github-connect";
export { NavRail } from "./components/nav-rail";
export type { NavEntry, NavModuleId } from "./components/nav-rail";
export {
  CheckRunRow,
  CiChecksBadge,
  CiChecksList,
  CiStatusPanel,
  CiWorkflowRuns,
} from "./components/ci-status";
export { Deployments, DeploymentList, deploymentOutcome, deploymentStatusText } from "./components/deployments";
export { PrPanel } from "./components/pr-panel";
export { ProjectPicker } from "./components/project-picker";
export { PullRequestDetail } from "./components/pull-request-detail";
export { PullRequestList } from "./components/pull-request-list";
export { RepoBrowser } from "./components/repo-browser";
export { RepoPicker } from "./components/repo-picker";
export { SettingsPage } from "./components/settings-page";
export { Sidebar } from "./components/sidebar";
export type { Agent, CachedPullRequest, CachedRepo, CachedRepoGates, ChatMessage as ChatMessageRecord, Conversation, ConversationKind, Deployment, DeploymentStatus, GitHubConnection, GitHubConnectionStatus, GitHubConnectionType, MessageStatus, Project, Repo, Setting } from "./db";
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
  checkOutcome,
  githubClient,
  summarizeChecks,
} from "./services/github";
export type {
  BranchProtectionResult,
  CheckConclusion,
  CheckRun,
  CheckRunStatus,
  ChecksSummary,
  CombinedStatus,
  DeviceFlowHandle,
  DevicePollResult,
  GitHubRepo,
  GitHubRequestOpts,
  GitHubResponse,
  GitHubTransport,
  GitHubTransportKind,
  MergeMethod,
  MergeResult,
  ProtectedBranch,
  PullRequest,
  PullRequestFile,
  PullRequestReview,
  ReviewEvent,
  WorkflowMeta,
  WorkflowRun,
} from "./services/github";
export {
  allowGreen,
  allowedMergeMethods,
  approvingReviewCount,
  canMergePullRequest,
  defaultMergeMethod,
  deriveRepoGates,
  deriveReviewState,
  resolveRequiredChecks,
} from "./services/repo-gates";
export type { MergeEligibility, RepoGates, RequiredCheckResult, ReviewState } from "./services/repo-gates";
export type { ChatState, ConnectionStatus, SlashCommand } from "./stores/chat";
export { useChatStore } from "./stores/chat";
export type { DeviceFlowState, GitHubState } from "./stores/github";
export { useGitHubStore, setDesktopFetchImpl } from "./stores/github";
export type { ProjectInput, ProjectsState } from "./stores/projects";
export { useProjectsStore } from "./stores/projects";
export type { PrDetail, PrsState } from "./stores/prs";
export { usePrsStore } from "./stores/prs";
export type { ReposState } from "./stores/repos";
export { useReposStore } from "./stores/repos";
