import { expect, type Page } from "@playwright/test";

// ============================================================================
// Shared helpers for the Talaria PWA smoke suite.
//
// The app persists conversations/repos/PRs through the Hermes gateway, so a
// smoke run against a live gateway renders real data (nondeterministic) while a
// run against no gateway renders empty/unauthorized states. To keep assertions
// repeatable we stub the gateway surface to a deterministic "unauthorized /
// no gateway" response by default. A handful of tests deliberately do NOT stub,
// to prove the real app boots without uncaught errors.
// ============================================================================

/** NavRail label for each module (must match nav-rail.tsx DEFAULT_ENTRIES). */
export const NAV_LABEL: Record<string, string> = {
  chat: "Chat",
  "command-center": "Command Center",
  observability: "Observability",
  wip: "WIP",
  deployments: "Deployments",
  docs: "Docs",
  editor: "Editor",
  settings: "Settings",
};

/**
 * Body-unique marker for each module: text that only renders inside that
 * module's panel, never in the persistent NavRail / header chrome. Verified
 * against the live app on the stubbed (unauthorized) gateway surface.
 */
export const BODY_MARKER: Record<string, string> = {
  chat: "Send a message to start chatting",
  "command-center": "live Hermes kanban",
  observability: "Agent Observability",
  wip: "Connect GitHub to browse your repos.",
  deployments: "Connect GitHub in Settings to trigger deployments.",
  docs: "Project Docs",
  settings: "Hermes Gateway API Server key",
};

export const navRail = (page: Page) => page.getByRole("navigation", { name: "Modules" });

export function moduleButton(page: Page, id: string) {
  return navRail(page).getByRole("button", { name: NAV_LABEL[id], exact: true });
}

/** Stub the gateway so every module renders a deterministic empty/unauth state. */
export async function installGatewayStub(page: Page) {
  // Hermes gateway API surface (chat sessions, docs proxy, github proxy, …).
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );
  // Kanban board surface (a separate path prefix off the same gateway root).
  await page.route("**/kanban-api/**", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
  );
  // Desktop-native config endpoint is not served by the web host.
  await page.route("**/talaria-config", (route) => route.fulfill({ status: 404, body: "" }));
}

/** Collect uncaught application exceptions (real crashes, not network 4xx/5xx). */
export function attachErrorCollector(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

export async function clickModule(page: Page, id: string) {
  await moduleButton(page, id).click();
}

/** The rail entry for the active module carries aria-current="page". */
export async function assertModuleActive(page: Page, id: string) {
  await expect(moduleButton(page, id)).toHaveAttribute("aria-current", "page");
}

export async function expectActiveMarker(page: Page, id: string) {
  await assertModuleActive(page, id);
  await expect(page.getByText(BODY_MARKER[id], { exact: false }).first()).toBeVisible();
}

/** Boot the app with the deterministic gateway stub and wait for chat. */
export async function bootStubbed(page: Page) {
  await installGatewayStub(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(BODY_MARKER.chat)).toBeVisible();
}
