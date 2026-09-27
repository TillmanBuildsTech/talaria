import { expect, test, type Page } from "@playwright/test";
import {
  assertModuleActive,
  attachErrorCollector,
  BODY_MARKER,
  bootStubbed,
  clickModule,
  expectActiveMarker,
  moduleButton,
  NAV_LABEL,
  navRail,
} from "./helpers";

// ============================================================================
// Talaria PWA — module smoke suite.
//
// Every module in the NavRail is exercised: click the rail entry, assert the
// module's OWN content renders (BODY marker, unique to the module panel — never
// the persistent rail label), and assert nav swaps cleanly. The known failure
// class is a module page leaking across every route / broken ternary wiring in
// packages/talaria-ui/src/app.tsx (see git history fix/observability-ui).
//
// MODULE SET is derived from NavModuleId in
// packages/talaria-ui/src/components/nav-rail.tsx. NOTE (2026-09): the `repos`
// and `prs` modules were removed on dev and superseded by a single `wip`
// (Work In Progress) module — the repo/PR browser now lives inside WipView. The
// `nav rail exposes exactly the current NavModuleId set` test below guards
// against the stale-artifact failure mode that resurrects the old module list.
//
// Gateway-dependent modules may show an empty / unauthorized state when no
// gateway (or key) is present — acceptable, as long as they do NOT crash,
// blank, or render "coming soon". Tests that need determinism run against the
// stubbed gateway surface (installGatewayStub); one test runs unstubbed to
// prove the real app boots cleanly.
// ============================================================================

// The module set the NavRail must expose, in rail order.
const EXPECTED_RAIL = [
  "Chat",
  "Command Center",
  "Observability",
  "WIP",
  "Deployments",
  "Docs",
  "Editor",
  "Settings",
];

/**
 * The command center may render a live board, an empty board, a loading state,
 * or the "API key required" locked state depending on gateway availability.
 * The point is that KanbanBoard actually mounted content instead of crashing or
 * blanking.
 */
async function assertBoardAreaRendered(page: Page) {
  const candidates = [
    "No tasks",
    "Board locked",
    "Loading board…",
    "Could not load",
    "no board yet",
  ];
  const body = await page.locator("body").innerText();
  const hit = candidates.some((c) => body.includes(c));
  expect(hit, `command center board area should render one of ${candidates.join(" / ")}`).toBe(true);
}

test.describe("Talaria PWA — boot", () => {
  test("real app boots with no uncaught page errors and a usable composer", async ({ page }) => {
    const errors = attachErrorCollector(page);
    await page.goto("/");
    await expect(page.locator("textarea").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
    expect(errors, "uncaught page errors on boot").toEqual([]);
  });

  test("nav rail exposes exactly the current NavModuleId set (no stale modules)", async ({ page }) => {
    await bootStubbed(page);
    const labels = await navRail(page).getByRole("button").allInnerTexts();
    const normalized = labels.map((l) => l.trim().split("\n")[0].trim()).filter(Boolean);
    expect(normalized).toEqual(EXPECTED_RAIL);
    // Removed-on-dev modules must not reappear (stale @talaria/ui dist guard).
    await expect(navRail(page).getByRole("button", { name: "Repos", exact: true })).toHaveCount(0);
    await expect(navRail(page).getByRole("button", { name: "Pull Requests", exact: true })).toHaveCount(0);
  });
});

test.describe("Talaria PWA — module smoke", () => {
  test("chat — empty state, input enabled, send UI present", async ({ page }) => {
    await bootStubbed(page);
    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible();
    await expect(textarea).toBeEnabled();
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
    // "Stop generating" is streaming-only (chat-input.tsx renders Stop while
    // isStreaming, Send otherwise) — its absence in the idle state is correct.
    await expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0);
  });

  test("command-center — KanbanBoard renders without crashing", async ({ page }) => {
    await bootStubbed(page);
    await clickModule(page, "command-center");
    await assertModuleActive(page, "command-center");
    await expect(page.getByText("live Hermes kanban")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("coming soon", { useInnerText: true });
    await assertBoardAreaRendered(page);
  });

  test("observability — Observability renders", async ({ page }) => {
    await bootStubbed(page);
    await clickModule(page, "observability");
    await expectActiveMarker(page, "observability");
    // Timeline affordances that prove the module (not just its title) mounted.
    await expect(page.getByRole("button", { name: "Agent timeline" })).toBeVisible();
  });

  test("wip — WipView renders (repo/PR browser, supersedes repos + prs modules)", async ({ page }) => {
    await bootStubbed(page);
    await clickModule(page, "wip");
    await assertModuleActive(page, "wip");
    // WipView has two mount shapes: the unauthorized GitHub gate, or the repo
    // list (heading + refresh/filter controls) once an account is connected.
    const mounted = [
      page.getByText("Connect GitHub to browse your repos."),
      page.getByRole("heading", { name: "WIP" }),
      page.getByRole("button", { name: "Refresh" }),
      page.getByLabel("Filter repos"),
    ];
    let anyVisible = false;
    for (const c of mounted) {
      if ((await c.count()) > 0 && (await c.first().isVisible().catch(() => false))) {
        anyVisible = true;
        break;
      }
    }
    expect(anyVisible, "WipView should render the GitHub gate or the repo list").toBe(true);
  });

  test("deployments — Deployments renders", async ({ page }) => {
    await bootStubbed(page);
    await clickModule(page, "deployments");
    await assertModuleActive(page, "deployments");
    const candidates = [
      page.getByText("Connect GitHub in Settings to trigger deployments."),
      page.getByRole("button", { name: "Refresh status" }),
      page.getByText("Pick a workflow to dispatch."),
    ];
    let anyVisible = false;
    for (const c of candidates) {
      if ((await c.count()) > 0 && (await c.first().isVisible().catch(() => false))) {
        anyVisible = true;
        break;
      }
    }
    expect(anyVisible, "Deployments should render its gate or its workflow picker").toBe(true);
  });

  test("docs — DocsEditor renders", async ({ page }) => {
    await bootStubbed(page);
    await clickModule(page, "docs");
    await expectActiveMarker(page, "docs");
    await expect(page.getByText("Docs live per project", { exact: false })).toBeVisible();
  });

  test("editor — CodeEditor is desktop-only: web surface degrades gracefully", async ({ page }) => {
    await bootStubbed(page);
    const editorBtn = moduleButton(page, "editor");
    await expect(editorBtn).toBeDisabled();
    await expect(editorBtn).toHaveAttribute("title", /desktop only/);
    // The app must remain fully interactive (no crash blanking the page).
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  });

  test("settings — SettingsPage renders and close returns to chat", async ({ page }) => {
    await bootStubbed(page);
    await clickModule(page, "settings");
    await expectActiveMarker(page, "settings");
    await page.getByRole("button", { name: "Close settings" }).click();
    await assertModuleActive(page, "chat");
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  });
});

test.describe("Talaria PWA — cross-module leakage", () => {
  // The known failure class: a module page leaking across all routes / broken
  // ternary wiring (app.tsx module chain). Navigate a chain of modules and
  // assert the PREVIOUS module's body marker is gone once the next is active.
  const LEAK_CHAIN: Array<[string, string]> = [
    ["chat", "observability"],
    ["observability", "command-center"],
    ["command-center", "docs"],
    ["docs", "settings"],
  ];

  for (const [from, to] of LEAK_CHAIN) {
    test(`navigate ${from} → ${to}: no ${from} residue on ${to}`, async ({ page }) => {
      await bootStubbed(page);
      if (from !== "chat") {
        await clickModule(page, from);
      }
      await expectActiveMarker(page, from);

      await clickModule(page, to);
      await assertModuleActive(page, to);

      // The previous module's body marker must be gone.
      await expect(page.getByText(BODY_MARKER[from], { exact: false })).toHaveCount(0);
    });
  }
});

test.describe("Talaria PWA — unstubbed real-environment boot", () => {
  // Same boot path with a real (possibly live) gateway: proves the suite is not
  // only green because of the stub. Navigation must still swap cleanly.
  test("chat → wip → settings swap cleanly against the real gateway surface", async ({ page }) => {
    const errors = attachErrorCollector(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("textarea").first()).toBeVisible();
    await clickModule(page, "wip");
    await assertModuleActive(page, "wip");
    await clickModule(page, "settings");
    await expectActiveMarker(page, "settings");
    expect(errors, "uncaught page errors during real-env navigation").toEqual([]);
  });
});

// Guard: every NAV_LABEL key must be a real rail entry (keeps helpers honest).
test("helpers NAV_LABEL covers every rail module", async ({ page }) => {
  await bootStubbed(page);
  for (const id of Object.keys(NAV_LABEL)) {
    await expect(moduleButton(page, id)).toHaveCount(1);
  }
});
