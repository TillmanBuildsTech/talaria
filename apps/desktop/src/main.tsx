import { App, configureDocsFileSystem, setDesktopFetchImpl, type DocsFileSystem } from "@talaria/ui";
import "@talaria/ui/styles.css";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BaseDirectory, readDir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";

// Desktop-only extras (P6): the desktop shell reads/writes project docs
// directly on the Hermes host filesystem via the Tauri fs plugin — no gateway
// round-trip. Web/PWA keeps the gateway transport. Both reach the SAME server
// directory (~/.hermes/projects/<slug>/docs), so the shared Docs editor works
// identically in either shell.
//
// The project-docs root is resolved under the user's home (BaseDirectory.Home)
// so it matches Hermes' server layout (~/.hermes/projects). Paths passed to
// these functions are relative to HOME (e.g. ".hermes/projects/talaria/docs").
const homeFs: DocsFileSystem = {
  readFile: async (path) => readTextFile(path, { baseDir: BaseDirectory.Home }),
  writeFile: async (path, content) => writeTextFile(path, content, { baseDir: BaseDirectory.Home }),
  removeFile: async (path) => remove(path, { baseDir: BaseDirectory.Home }),
  listDir: async (path) => {
    const entries = await readDir(path, { baseDir: BaseDirectory.Home });
    return entries.map((e) => ({ name: e.name, isDir: e.isDirectory ?? false }));
  },
};

// Register the native filesystem adapter BEFORE the app mounts so the docs
// store's init() picks up the filesystem transport for desktop.
configureDocsFileSystem(homeFs);

// The Tauri webview's own fetch() cannot reach github.com (no CORS headers),
// which surfaced as "Load failed" on the GitHub device-flow login. Inject the
// Tauri HTTP plugin's native fetch (Rust-side, no webview CORS) so the GitHub
// direct transport works on desktop. Must run before the app mounts/initializes.
setDesktopFetchImpl(tauriFetch as unknown as typeof fetch);

const container = document.getElementById("root");
if (!container) throw new Error("#root element not found");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
