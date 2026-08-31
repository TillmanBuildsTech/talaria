import { defineConfig } from "@playwright/test";

// Talaria PWA smoke suite.
//
// Two projects exercise the SAME module-navigation specs against two servers:
//   - dev     : `pnpm --filter @talaria/pwa dev`  (Vite dev server, /api proxied)
//   - preview : `pnpm --filter @talaria/pwa build && preview` (production build —
//               this is where the service worker / manifest actually register)
//
// PWA-installability checks are gated to the preview project (the built app is
// the only surface where generateSW produces a real precache + SW registration).
// /api requests hit the Hermes gateway on localhost:8642; without a gateway the
// modules still render their empty/error states (which is what the suite asserts
// for the gateway-dependent modules). The app must never crash or blank on boot.

const previewPort = 4173;
const devPort = 5174;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${previewPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "dev",
      use: { baseURL: `http://localhost:${devPort}` },
    },
    {
      name: "preview",
      use: { baseURL: `http://localhost:${previewPort}` },
    },
  ],
  webServer: [
    {
      command: `pnpm --filter @talaria/pwa preview --port ${previewPort} --strictPort`,
      url: `http://localhost:${previewPort}`,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: `pnpm --filter @talaria/pwa dev --port ${devPort} --strictPort`,
      url: `http://localhost:${devPort}`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
