import { expect, test, type Page } from "@playwright/test";

// ============================================================================
// Talaria PWA smoke suite.
//
// Every module in the NavRail (see packages/talaria-ui/src/app.tsx module
// ternary ~line 300-365, and nav-rail.tsx NavModuleId) is exercised: click the
// rail entry, assert the module's OWN content renders, and assert it did NOT
// leave a previous module's page leaked on screen (the known broken-ternary
// failure class — see git history fix/observability-ui, app.tsx:295).
//
// Gateway-dependent modules (command-center, repos, prs, deployments) may show
// an empty/error/loading state when no Hermes gateway/auth is present — that is
// ACCEPTABLE as long as they do NOT crash, blank, or render "coming soon".
// Editor is desktop-only and MUST degrade gracefully (disabled nav entry +
// "desktop only" note) rather than crash the web surface.
//
// MARKER NOTE: the NavRail renders a persistent column of labels on every
// module (Chat, Command Center, …). So "Command Center"/"Settings"/"Docs" etc.
// are NOT body-unique strings. Positive asserts therefore rely on (a) the rail
// entry's aria-current="page" and (b) a BODY-ONLY marker that only renders when
// that module is active. Leakage asserts use the BODY markers, which disappear
// when the module unmounts. The BODY markers below are chosen to be unique to
// the module panel and absent from the nav rail + chrome.
// ============================================================================

// Module → its nav-rail label (exact match).
const NAV_LABEL: Record<string, string> = {
  chat: "Chat",
  "command-center": "Command Center",
  observability: "Observability",
  repos: "Repos",
  prs: "Pull Requests",
  deployments: "Deployments",
  docs: "Docs",
  editor: "Editor",
  settings: "Settings",
};

// Module → BODY-ONLY marker: text that appears ONLY inside the module panel
// (never in the persistent nav rail / header chrome). Verified against the
// live app (no gateway auth): each string below is what that module's panel
// actually renders in its empty/unauthorized state.
const BODY_MARKER: Record<string, string> = {
  chat: "Send a message to start chatting",
  "command-center": "No tasks", // empty board body (see probe); see cmdCenterBody below for resilience
  observability: "Agent Observability",
  repos: "Connect GitHub to browse your repos.",
  prs: "Select a repository on the left",
  deployments: "Connect GitHub in Settings to trigger deployments.",
  docs: "Project Docs",
  settings: "Hermes Gateway API Server key",
};

const navRail = (page: Page) => page.getByRole("navigation", { name: "Modules" });

async function clickModule(page: Page, id: string) {
  await navRail(page).getByRole("button", { name: NAV_LABEL[id], exact: true }).click();
}

async function assertModuleActive(page: Page, id: string) {
  await expect(navRail(page).getByRole("button", { name: NAV_LABEL[id], exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
}

// The command-center may render a real board, "Loading board…", or "No tasks"
// depending on gateway presence. Accept any of the three; the point is the
// KanbanBoard actually mounted (not a crash/blank/"coming soon").
async function assertCommandCenterBodyRendered(page: Page) {
  const candidates = [
    page.getByText("No tasks"),
    page.getByText("Loading board…"),
    page.locator('[aria-label="Close command center"]'),
  ];
  let anyVisible = false;
  for (const c of candidates) {
    if ((await c.count()) > 0 && (await c.first().isVisible().catch(() => false))) {
      anyVisible = true;
      break;
    }
  }
  expect(anyVisible, "KanbanBoard should render a board, empty, or loading state — not crash/blank").toBe(true);
}

// Collect uncaught page errors (real application exceptions). Console network
// 4xx/5xx to the gateway are expected without auth and are NOT page errors.
async function attachErrorCollector(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

test.describe("Talaria PWA — module smoke", () => {
  test("boots cleanly with no uncaught page errors", async ({ page }) => {
    const errors = await attachErrorCollector(page);
    await page.goto("/");
    await expect(page.getByText(BODY_MARKER.chat)).toBeVisible();
    expect(errors, "uncaught page errors on boot").toEqual([]);
  });

  test("chat — empty state, input enabled, send present", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(BODY_MARKER.chat)).toBeVisible();
    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible();
    await expect(textarea).toBeEnabled();
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
    // "Stop generating" is streaming-only: ChatInput renders Stop while
    // isStreaming is true and Send otherwise (chat-input.tsx:169). In the idle
    // empty state it must be absent — not a defect, correct conditional render.
    await expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0);
  });

  test("command-center — KanbanBoard renders without crashing", async ({ page }) => {
    await page.goto("/");
    await clickModule(page, "command-center");
    await assertModuleActive(page, "command-center");
    await expect(page.locator("body")).not.toContainText("coming soon", { useInnerText: true });
    await assertCommandCenterBodyRendered(page);
  });

  test("observability — Observability renders", async ({ page }) => {
    await page.goto("/");
    await clickModule(page, "observability");
    await assertModuleActive(page, "observability");
    await expect(page.getByText(BODY_MARKER.observability).first()).toBeVisible();
  });

  test("repos — RepoBrowser renders", async ({ page }) => {
    await page.goto("/");
    await clickModule(page, "repos");
    await assertModuleActive(page, "repos");
    await expect(page.getByText(BODY_MARKER.repos).first()).toBeVisible();
  });

  test("prs — PrPanel renders and close returns to chat", async ({ page }) => {
    await page.goto("/");
    await clickModule(page, "prs");
    await assertModuleActive(page, "prs");
    await expect(page.getByText(BODY_MARKER.prs).first()).toBeVisible();
    await page.getByRole("button", { name: "Close PRs" }).click();
    await expect(page.getByText(BODY_MARKER.chat)).toBeVisible();
  });

  test("deployments — Deployments renders", async ({ page }) => {
    await page.goto("/");
    await clickModule(page, "deployments");
    await assertModuleActive(page, "deployments");
    await expect(page.getByText(BODY_MARKER.deployments).first()).toBeVisible();
  });

  test("docs — DocsEditor renders", async ({ page }) => {
    await page.goto("/");
    await clickModule(page, "docs");
    await assertModuleActive(page, "docs");
    await expect(page.getByText(BODY_MARKER.docs).first()).toBeVisible();
  });

  test("editor — CodeEditor is desktop-only: web surface degrades gracefully (disabled, no crash)", async ({
    page,
  }) => {
    await page.goto("/");
    const editorBtn = navRail(page).getByRole("button", { name: "Editor", exact: true });
    await expect(editorBtn).toBeDisabled();
    await expect(editorBtn).toHaveAttribute("title", /desktop only/);
    // The app must still be fully interactive (no crash blanking the page).
    await expect(page.getByText(BODY_MARKER.chat)).toBeVisible();
  });

  test("settings — SettingsPage renders and close returns to chat", async ({ page }) => {
    await page.goto("/");
    await clickModule(page, "settings");
    await assertModuleActive(page, "settings");
    await expect(page.getByText(BODY_MARKER.settings).first()).toBeVisible();
    await page.getByRole("button", { name: "Close settings" }).click();
    await expect(page.getByText(BODY_MARKER.chat)).toBeVisible();
  });
});

test.describe("Talaria PWA — cross-module leakage", () => {
  // The known failure class: a module page leaking across all routes / broken
  // ternary wiring (see git history fix/observability-ui, app.tsx:295). Navigate
  // a chain of modules and assert the PREVIOUS module's BODY marker disappears
  // once the next module is active.
  const LEAK_CHAIN: Array<[string, string]> = [
    ["chat", "observability"],
    ["observability", "command-center"],
    ["command-center", "docs"],
    ["docs", "settings"],
  ];

  for (const [from, to] of LEAK_CHAIN) {
    test(`navigate ${from} → ${to}: no ${from} residue on ${to}`, async ({ page }) => {
      await page.goto("/");
      await clickModule(page, from);
      await assertModuleActive(page, from);
      await expect(page.getByText(BODY_MARKER[from], { exact: false }).first()).toBeVisible();

      await clickModule(page, to);
      await assertModuleActive(page, to);

      // The previous module's BODY marker must be gone.
      await expect(page.getByText(BODY_MARKER[from], { exact: false })).toHaveCount(0);
    });
  }
});
