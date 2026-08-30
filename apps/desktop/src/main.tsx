import { App, setDesktopFetchImpl } from "@talaria/ui";
import "@talaria/ui/styles.css";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

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
