import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

// Provide a real (in-memory) IndexedDB so Dexie stores work in jsdom.
// Dexie reads these globals when it opens the database.
(globalThis as Record<string, unknown>).indexedDB = indexedDB;
(globalThis as Record<string, unknown>).IDBKeyRange = IDBKeyRange;

beforeEach(() => {
  // Fresh database per test (the Dexie instance caches a connection; deleting
  // tables via Dexie's deleteDatabase before reopen gives isolation).
  return import("dexie").then(async ({ default: Dexie }) => {
    try {
      await Dexie.delete("HermesChatDB");
    } catch {
      /* not present yet */
    }
  });
});

afterEach(() => {
  cleanup();
});
