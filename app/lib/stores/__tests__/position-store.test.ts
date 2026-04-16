import { describe, it, expect } from "vitest";
import { createStore, set as idbSet } from "idb-keyval";
import { Effect } from "effect";
import { makePositionService } from "../position-store";
import type { PositionRecord } from "../position-store";

// Create a test-only store (fake-indexeddb via vitest setupFiles)
function createTestStore() {
  const store = createStore("test-positions-" + Math.random(), "positions");
  return { store, service: makePositionService({ positionStore: store }) };
}

// ---------------------------------------------------------------------------
// migratePosition (tested via getPosition / getPositionRecord)
// ---------------------------------------------------------------------------

describe("position migration (via service)", () => {
  it("migrates a legacy plain-string CFI to { cfi, updatedAt: 0 }", async () => {
    const { store, service } = createTestStore();

    // Write a raw string directly (simulating old format)
    await idbSet("book-1", "epubcfi(/6/10)", store);

    const cfi = await Effect.runPromise(service.getPosition("book-1"));
    expect(cfi).toBe("epubcfi(/6/10)");

    const record = await Effect.runPromise(service.getPositionRecord("book-1"));
    expect(record).toEqual({ cfi: "epubcfi(/6/10)", updatedAt: 0 });
  });

  it("passes through a new-format record unchanged", async () => {
    const { store, service } = createTestStore();

    const newFormat: PositionRecord = { cfi: "epubcfi(/6/20)", updatedAt: 12345 };
    await idbSet("book-2", newFormat, store);

    const record = await Effect.runPromise(service.getPositionRecord("book-2"));
    expect(record).toEqual({ cfi: "epubcfi(/6/20)", updatedAt: 12345 });
  });

  it("returns null for a missing key", async () => {
    const { service } = createTestStore();

    const cfi = await Effect.runPromise(service.getPosition("nonexistent"));
    expect(cfi).toBeNull();

    const record = await Effect.runPromise(service.getPositionRecord("nonexistent"));
    expect(record).toBeNull();
  });

  it("returns null for an unexpected value type", async () => {
    const { store, service } = createTestStore();

    await idbSet("book-3", 42, store);

    const record = await Effect.runPromise(service.getPositionRecord("book-3"));
    expect(record).toBeNull();
  });

  it("defaults updatedAt to 0 when missing from record object", async () => {
    const { store, service } = createTestStore();

    // Object with cfi but no updatedAt
    await idbSet("book-4", { cfi: "epubcfi(/6/30)" }, store);

    const record = await Effect.runPromise(service.getPositionRecord("book-4"));
    expect(record).toEqual({ cfi: "epubcfi(/6/30)", updatedAt: 0 });
  });
});

// ---------------------------------------------------------------------------
// savePosition round-trip
// ---------------------------------------------------------------------------

describe("savePosition", () => {
  it("saves and retrieves a position with updatedAt timestamp", async () => {
    const { service } = createTestStore();

    await Effect.runPromise(service.savePosition("book-5", "epubcfi(/6/50)"));

    const record = await Effect.runPromise(service.getPositionRecord("book-5"));
    expect(record).not.toBeNull();
    expect(record!.cfi).toBe("epubcfi(/6/50)");
    expect(record!.updatedAt).toBeGreaterThan(0);
  });

  it("overwrites previous position", async () => {
    const { service } = createTestStore();

    await Effect.runPromise(service.savePosition("book-6", "epubcfi(/6/1)"));
    await Effect.runPromise(service.savePosition("book-6", "epubcfi(/6/2)"));

    const cfi = await Effect.runPromise(service.getPosition("book-6"));
    expect(cfi).toBe("epubcfi(/6/2)");
  });
});
