import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FolderPicker } from "./folder-picker";
import { docsClient, HOST_DIR_BASE, type HostDirListing } from "../services/docs";

// Reset the docs client's transport call between tests so assertions start clean.
beforeEach(() => {
  vi.restoreAllMocks();
});

describe("FolderPicker", () => {
  it("lists subdirectories from the host and shows git flags", async () => {
    const listSpy = vi
      .spyOn(docsClient, "listDirectory")
      .mockResolvedValue({
        path: HOST_DIR_BASE,
        entries: [
          { name: "repo-a", isDir: true, isGitRepo: true },
          { name: "plain", isDir: true, isGitRepo: false },
          { name: "notes.txt", isDir: false },
        ],
      } as HostDirListing);

    const onPick = vi.fn();
    render(<FolderPicker onPick={onPick} />);

    // Loads the base dir on mount.
    await waitFor(() => expect(listSpy).toHaveBeenCalledWith(HOST_DIR_BASE));
    expect(await screen.findByText("repo-a")).toBeInTheDocument();
    expect(screen.getByText("plain")).toBeInTheDocument();
    // Files are excluded from the navigable tree.
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
    // Git repos are tagged.
    expect(screen.getAllByText("git").length).toBeGreaterThan(0);
  });

  it("navigates into a subdirectory on click", async () => {
    const listSpy = vi
      .spyOn(docsClient, "listDirectory")
      .mockResolvedValueOnce({
        path: HOST_DIR_BASE,
        entries: [{ name: "repo-a", isDir: true, isGitRepo: true }],
      } as HostDirListing)
      .mockResolvedValueOnce({
        path: `${HOST_DIR_BASE}/repo-a`,
        entries: [{ name: ".git", isDir: true }],
      } as HostDirListing);

    render(<FolderPicker onPick={vi.fn()} />);
    fireEvent.click(await screen.findByText("repo-a"));

    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
    expect(listSpy).toHaveBeenLastCalledWith(`${HOST_DIR_BASE}/repo-a`);
    // Current dir updates; the git badge shows because .git is present.
    expect(await screen.findByText(`${HOST_DIR_BASE}/repo-a`)).toBeInTheDocument();
  });

  it("reports the picked folder's path and git status", async () => {
    vi.spyOn(docsClient, "listDirectory").mockResolvedValue({
      path: `${HOST_DIR_BASE}/repo-a`,
      entries: [
        { name: ".git", isDir: true },
        { name: "src", isDir: true },
      ],
    } as HostDirListing);

    const onPick = vi.fn();
    render(<FolderPicker initialPath={`${HOST_DIR_BASE}/repo-a`} onPick={onPick} />);

    fireEvent.click(await screen.findByRole("button", { name: "Select this folder" }));
    expect(onPick).toHaveBeenCalledWith({
      path: `${HOST_DIR_BASE}/repo-a`,
      isGitRepo: true,
    });
  });

  it("surfaces an error when listing fails", async () => {
    vi.spyOn(docsClient, "listDirectory").mockRejectedValue(new Error("no such directory"));

    render(<FolderPicker onPick={vi.fn()} />);
    expect(await screen.findByText("no such directory")).toBeInTheDocument();
    // No subdirectories render while errored.
    expect(screen.queryByRole("button", { name: "Select this folder" })).toBeDisabled();
  });
});
