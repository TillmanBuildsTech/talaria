import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hermesClient } from "./hermes";
import { kanbanClient } from "./kanban";

// Regression test for "kanban connection not working no matter which URL I
// try": the kanban client used to hardcode the same-origin path /kanban-api/*,
// so in the Tauri desktop app (localhost:1420) every board fetch 404'd and the
// baseUrl set in settings had NO effect on kanban. It must now derive its root
// from hermesClient.gatewayRoot() (the configured server origin) and send the
// bearer key, exactly like chat/sessions do.
describe("kanban client routing", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockReset();
    hermesClient.setBaseUrl("/api/v1");
    hermesClient.setApiKey("");
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).fetch;
  });

  it("same-origin (PWA default) resolves to a relative /kanban-api path with no auth header", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ board: "default", exists: true, columns: {} }) });
    await kanbanClient.fetchBoard();
    expect(fetchMock).toHaveBeenCalledWith(
      "/kanban-api/board",
      expect.objectContaining({ headers: { Accept: "application/json" } })
    );
  });

  it("cross-origin (desktop) resolves to an absolute URL off the configured gateway root + bearer key", async () => {
    hermesClient.setBaseUrl("https://hermes.tillmanbuildstech.com/api/v1");
    hermesClient.setApiKey("secret-key");
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ board: "default", exists: true, columns: {} }) });
    await kanbanClient.fetchBoard("myproj");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hermes.tillmanbuildstech.com/kanban-api/board?board=myproj",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer secret-key" }),
      })
    );
  });

  it("archive is a POST to the absolute origin carrying the bearer key", async () => {
    hermesClient.setBaseUrl("https://hermes.tillmanbuildstech.com");
    hermesClient.setApiKey("k");
    fetchMock.mockResolvedValue({ ok: true });
    await kanbanClient.archiveTask("t1", "proj");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hermes.tillmanbuildstech.com/kanban-api/tasks/t1/archive?board=proj",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer k" }),
      })
    );
  });
});
