import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStore, set as idbSet } from "idb-keyval";

const Effect = { runPromise: <A>(promise: Promise<A>) => promise };

vi.mock("~/lib/sync/change-log", () => ({
  recordChange: vi.fn().mockResolvedValue(undefined),
}));

import { recordChange } from "~/lib/sync/change-log";
import { makePositionService } from "../position-store";
import type { PositionRecord } from "../position-store";

function createTestStore() {
  const store = createStore("test-positions-" + Math.random(), "positions");
  return { store, service: makePositionService({ positionStore: store }) };
}

describe("position migration (via service)", () => {
  it("migrates a legacy plain-string CFI to { cfi, updatedAt: 0 }", async () => {
    const { store, service } = createTestStore();

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

    await idbSet("book-4", { cfi: "epubcfi(/6/30)" }, store);

    const record = await Effect.runPromise(service.getPositionRecord("book-4"));
    expect(record).toEqual({ cfi: "epubcfi(/6/30)", updatedAt: 0 });
  });
});

describe("savePosition", () => {
  beforeEach(() => {
    vi.mocked(recordChange).mockClear();
  });

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

  it("records a sync change by default", async () => {
    const { service } = createTestStore();

    await Effect.runPromise(service.savePosition("book-7", "epubcfi(/6/7)"));

    expect(recordChange).toHaveBeenCalledTimes(1);
    expect(recordChange).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "position",
        entityId: "book-7",
        operation: "put",
      }),
    );
  });

  it("skips recordChange when options.recordChange is false (local-only write)", async () => {
    const { service } = createTestStore();

    await Effect.runPromise(
      service.savePosition("panel-xyz", "epubcfi(/6/8)", { recordChange: false }),
    );

    const record = await Effect.runPromise(service.getPositionRecord("panel-xyz"));
    expect(record?.cfi).toBe("epubcfi(/6/8)");

    expect(recordChange).not.toHaveBeenCalled();
  });

  it("skips IDB write and recordChange when saving the same CFI twice", async () => {
    const { service } = createTestStore();

    await Effect.runPromise(service.savePosition("book-9", "epubcfi(/6/90)"));
    const first = await Effect.runPromise(service.getPositionRecord("book-9"));
    expect(recordChange).toHaveBeenCalledTimes(1);

    await Effect.runPromise(service.savePosition("book-9", "epubcfi(/6/90)"));
    const second = await Effect.runPromise(service.getPositionRecord("book-9"));

    expect(recordChange).toHaveBeenCalledTimes(1);
    expect(second?.updatedAt).toBe(first?.updatedAt);
  });

  it("preserves updatedAt when restore enriches the same CFI with layout data", async () => {
    const { store, service } = createTestStore();
    await idbSet("book-restore", { cfi: "epubcfi(/6/90)", updatedAt: 123 }, store);

    await Effect.runPromise(
      service.savePosition("book-restore", "epubcfi(/6/90)", {
        localProgression: 0.5,
        spineIndex: 2,
      }),
    );

    await expect(Effect.runPromise(service.getPositionRecord("book-restore"))).resolves.toEqual({
      cfi: "epubcfi(/6/90)",
      updatedAt: 123,
      localProgression: 0.5,
      spineIndex: 2,
    });
    expect(recordChange).not.toHaveBeenCalled();
  });

  it("still records a change when CFI changes to a new value", async () => {
    const { service } = createTestStore();

    await Effect.runPromise(service.savePosition("book-10", "epubcfi(/6/10)"));
    await Effect.runPromise(service.savePosition("book-10", "epubcfi(/6/11)"));

    expect(recordChange).toHaveBeenCalledTimes(2);
    const cfi = await Effect.runPromise(service.getPosition("book-10"));
    expect(cfi).toBe("epubcfi(/6/11)");
  });

  it("keeps rapid local-only relocations in IDB and records one debounced changelog", async () => {
    const { service } = createTestStore();
    let debouncedCfi = "";
    const scheduleChangelog = (cfi: string) => {
      debouncedCfi = cfi;
    };

    await Effect.runPromise(
      service.savePosition("book-11", "epubcfi(/6/11)", { recordChange: false }),
    );
    scheduleChangelog("epubcfi(/6/11)");
    expect(await Effect.runPromise(service.getPosition("book-11"))).toBe("epubcfi(/6/11)");

    await Effect.runPromise(
      service.savePosition("book-11", "epubcfi(/6/12)", { recordChange: false }),
    );
    scheduleChangelog("epubcfi(/6/12)");
    expect(await Effect.runPromise(service.getPosition("book-11"))).toBe("epubcfi(/6/12)");
    expect(recordChange).not.toHaveBeenCalled();

    await Effect.runPromise(service.savePosition("book-11", debouncedCfi));

    expect(recordChange).toHaveBeenCalledTimes(1);
    expect(recordChange).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "position",
        entityId: "book-11",
        data: expect.objectContaining({ cfi: "epubcfi(/6/12)" }),
      }),
    );

    await Effect.runPromise(service.savePosition("book-11", "epubcfi(/6/12)"));
    expect(recordChange).toHaveBeenCalledTimes(1);
  });
});
