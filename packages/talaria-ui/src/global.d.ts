// Build-time define injected by the host app's Vite config (see
// apps/pwa/vite.config.ts) — the default profile's API key baked in at build
// time so the app auto-provisions itself without requiring Settings entry.
declare const __HERMES_API_KEY__: string | undefined;
// Optional build-time define — the GitHub OAuth App's public Client ID. When
// absent, the service falls back to a placeholder (see services/github.ts).
declare const __GITHUB_CLIENT_ID__: string | undefined;
