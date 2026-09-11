import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Deployments } from "./deployments";
import { useGitHubStore } from "../stores/github";
import { useReposStore } from "../stores/repos";
import { useProjectsStore } from "../stores/projects";
import { getVercelKeyConfigured, saveVercelApiKey } from "../services/vercel-key";
import type { Deployment } from "../db";

// QA S3 follow-up (t_a680807c): UX-F5 (fresh-user copy) + UX-F6 (dispatch
// failure must not be reported as a key-save failure).
vi.mock("../services/vercel-key", () => ({
  getVercelKeyConfigured: vi.fn(),
  saveVercelApiKey: vi.fn(),
}));

const CONN = {
  id: "tillmanbuildstech",
  owner: "tillmanbuildstech",
  type: "device",
  status: "connected",
  scopes: ["repo"],
  tokenRef: "gw-ref-test",
  gatewayOrigin: "",
  lastVerifiedAt: 0,
  connectedAt: 0,
} as const;

const WF = {
  id: 1,
  name: "Deploy",
  path: ".github/workflows/deploy.yml",
  state: "active",
  htmlUrl: "https://github.com/tillmanbuildstech/talaria/actions/workflows/deploy.yml",
};

function mountDeployments() {
  return render(<Deployments owner="tillmanbuildstech" repo="talaria" project={null} />);
}

beforeEach(() => {
  vi.mocked(getVercelKeyConfigured).mockReset();
  vi.mocked(saveVercelApiKey).mockReset();
  useGitHubStore.setState({
    connections: [CONN] as never,
    deployments: [],
    listDispatchableWorkflows: vi.fn().mockResolvedValue([WF]),
    loadDeployments: vi.fn().mockResolvedValue(undefined),
    dispatchDeployment: vi.fn().mockResolvedValue(null as unknown as Deployment),
    refreshDeployment: vi.fn().mockResolvedValue({} as Deployment),
  });
  useReposStore.setState({ repos: [] } as never);
  useProjectsStore.setState({ projects: [], activeProjectId: null } as never);
});

async function triggerDeploymentWithNewKey() {
  fireEvent.click(await screen.findByText(/\+ Trigger deployment/i));
  fireEvent.change(screen.getByLabelText(/Workflow/i), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText(/Branch \/ ref/i), { target: { value: "main" } });
  fireEvent.click(screen.getByText(/^Dispatch$/i)); // no key stored -> gate trips -> prompt
  // VAL-F11: the gate re-verifies config FRESH at dispatch time (async), so the
  // prompt renders a tick after the click — await it.
  fireEvent.change(await screen.findByPlaceholderText(/Paste Vercel API key/i), {
    target: { value: "vercel-token-xyz" },
  });
  fireEvent.click(screen.getByText(/Save & continue/i));
}

describe("Deployments — Vercel key prompt UX (QA UX-F5, UX-F6)", () => {
  it("shows add/required copy (not update copy) for a first-time setup", async () => {
    vi.mocked(getVercelKeyConfigured).mockResolvedValue(false); // no key stored
    mountDeployments();
    fireEvent.click(await screen.findByText(/Set Vercel API key/i));

    // First-time mode: must NOT read as an update of an existing key.
    expect(await screen.findByText(/Vercel API key required/i)).toBeInTheDocument();
    expect(screen.queryByText(/Update Vercel API key/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Replace the saved default/i)).not.toBeInTheDocument();
  });

  it("shows update/replace copy when a key is already configured", async () => {
    vi.mocked(getVercelKeyConfigured).mockResolvedValue(true); // key already stored
    mountDeployments();
    fireEvent.click(await screen.findByText(/Vercel API key · change/i));

    expect(await screen.findByText(/Update Vercel API key/i)).toBeInTheDocument();
    expect(screen.getByText(/Replace the saved default/i)).toBeInTheDocument();
  });

  it("reports a dispatch failure as a dispatch error, not a key-save error", async () => {
    vi.mocked(getVercelKeyConfigured).mockResolvedValue(false); // no key -> gate trips
    vi.mocked(saveVercelApiKey).mockResolvedValue(undefined); // save succeeds
    useGitHubStore.setState({
      dispatchDeployment: vi
        .fn()
        .mockRejectedValue(new Error("workflow_dispatch: 422 repo is archived")),
    } as never);

    mountDeployments();
    await triggerDeploymentWithNewKey();

    // The dispatch error must surface as a dispatch error, not the save error.
    expect(await screen.findByText(/workflow_dispatch: 422 repo is archived/i)).toBeInTheDocument();
    expect(screen.queryByText(/Could not save Vercel API key/i)).not.toBeInTheDocument();
    // The dispatch error reopens the trigger form so the user can retry.
    expect(screen.getByText(/^Dispatch$/i)).toBeInTheDocument();
  });

  it("reports a key-save failure as a key-save error and keeps the prompt open", async () => {
    vi.mocked(getVercelKeyConfigured).mockResolvedValue(false);
    vi.mocked(saveVercelApiKey).mockRejectedValue(new Error("Could not save Vercel API key (HTTP 500)"));

    mountDeployments();
    fireEvent.click(await screen.findByText(/Set Vercel API key/i));
    fireEvent.change(screen.getByPlaceholderText(/Paste Vercel API key/i), {
      target: { value: "vercel-token-xyz" },
    });
    fireEvent.click(screen.getByText(/Save & continue/i));

    expect(await screen.findByText(/Could not save Vercel API key \(HTTP 500\)/i)).toBeInTheDocument();
    // Prompt stays open so the user can retry — no dispatch attempted.
    expect(screen.getByText(/Vercel API key required/i)).toBeInTheDocument();
  });
});
