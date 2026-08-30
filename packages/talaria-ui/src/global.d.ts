// Build-time define injected by the host app's Vite config (see
// apps/pwa/vite.config.ts) — the default profile's API key baked in at build
// time so the app auto-provisions itself without requiring Settings entry.
declare const __HERMES_API_KEY__: string | undefined;
