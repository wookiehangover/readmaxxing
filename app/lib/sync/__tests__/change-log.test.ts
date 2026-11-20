import { describe, it, expect, beforeEach } from "vitest";
import { recordChange, getUnsyncedChanges, markSynced, clearSyncedChanges } from "../change-log";

beforeEach(async () => {
  const unsynced = await getUnsyncedChanges();
  if (unsynced.length > 0) {
    await markSynced(unsynced.map((c) => c.id));
    await clearSyncedChanges();
  }
  await clearSyncedChanges();
});

describe("recordChange", () => {
  it("produces a ChangeEntry with id and synced=false", async () => {
    const result = await recordChange({
      entity: "book",
      entityId: "book-1",
      operation: "put",
      data: { title: "Test Book" },
      timestamp: 1000,
    });

    expect(result.id).toBeDefined();
    expect(typeof result.id).toBe("string");
    expect(result.synced).toBe(false);
    expect(result.entity).toBe("book");
    expect(result.entityId).toBe("book-1");
    expect(result.operation).toBe("put");
    expect(result.data).toEqual({ title: "Test Book" });
    expect(result.timestamp).toBe(1000);
  });

  it("generates unique IDs for each change", async () => {
    const a = await recordChange({
      entity: "book",
      entityId: "book-1",
      operation: "put",
      data: {},
      timestamp: 1000,
    });
    const b = await recordChange({
      entity: "book",
      entityId: "book-2",
      operation: "put",
      data: {},
      timestamp: 1001,
    });
    expect(a.id).not.toBe(b.id);
  });
});

describe("getUnsyncedChanges", () => {
  it("returns only unsynced entries", async () => {
    const c1 = await recordChange({
      entity: "book",
      entityId: "book-1",
      operation: "put",
      data: {},
      timestamp: 1000,
    });
    await recordChange({
      entity: "highlight",
      entityId: "hl-1",
      operation: "put",
      data: {},
      timestamp: 2000,
    });

    await markSynced([c1.id]);

    const unsynced = await getUnsyncedChanges();
    expect(unsynced).toHaveLength(1);
    expect(unsynced[0].entity).toBe("highlight");
  });

  it("returns entries sorted by ID (chronological ULID order)", async () => {
    await recordChange({
      entity: "book",
      entityId: "book-1",
      operation: "put",
      data: {},
      timestamp: 1000,
    });
    await recordChange({
      entity: "book",
      entityId: "book-2",
      operation: "put",
      data: {},
      timestamp: 2000,
    });

    const unsynced = await getUnsyncedChanges();
    expect(unsynced).toHaveLength(2);
    expect(unsynced[0].id < unsynced[1].id).toBe(true);
  });

  it("returns empty array when no unsynced changes exist", async () => {
    const unsynced = await getUnsyncedChanges();
    expect(unsynced).toEqual([]);
  });
});

describe("markSynced + clearSyncedChanges", () => {
  it("marks entries as synced and clears them", async () => {
    const c1 = await recordChange({
      entity: "book",
      entityId: "book-1",
      operation: "put",
      data: {},
      timestamp: 1000,
    });

    await markSynced([c1.id]);
    const cleared = await clearSyncedChanges();
    expect(cleared).toBe(1);

    const remaining = await getUnsyncedChanges();
    expect(remaining).toEqual([]);
  });
});
