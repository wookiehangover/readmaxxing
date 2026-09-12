import { describe, it, expect, beforeEach } from "vitest";
import {
  recordChange,
  getUnsyncedChanges,
  markSynced,
  clearSyncedChanges,
  recordPushFailures,
  isChangeReadyToPush,
} from "../change-log";

// fake-indexeddb is auto-loaded via vitest setupFiles

beforeEach(async () => {
  // Clear all changes by marking and clearing
  const unsynced = await getUnsyncedChanges();
  if (unsynced.length > 0) {
    await markSynced(unsynced.map((c) => c.id));
    await clearSyncedChanges();
  }
  // Also clear any already-synced leftovers
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

    // Mark c1 as synced
    await markSynced([c1.id]);

    const unsynced = await getUnsyncedChanges();
    expect(unsynced).toHaveLength(1);
    expect(unsynced[0].entity).toBe("highlight");
  });

  it("returns entries sorted by ID (chronological ULID order)", async () => {
    // Record in quick succession — ULIDs are monotonic
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
    // ULID ordering should be chronological
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

describe("durable delivery state", () => {
  it("retains permanent and legacy failures separately from acknowledgments", async () => {
    const permanent = await recordChange({
      entity: "notebook",
      entityId: "a",
      operation: "put",
      data: { content: "saved" },
      timestamp: 1,
    });
    const legacy = await recordChange({
      entity: "highlight",
      entityId: "b",
      operation: "put",
      data: { text: "highlight" },
      timestamp: 2,
    });
    await recordPushFailures(
      [
        { id: permanent.id, reason: "unsupported", retryable: false },
        { id: legacy.id, reason: "unknown" },
      ],
      100,
    );
    await clearSyncedChanges();
    const retained = await getUnsyncedChanges();
    const blocked = retained.find((change) => change.id === permanent.id)!;
    const delayed = retained.find((change) => change.id === legacy.id)!;
    expect(blocked.data).toEqual(permanent.data);
    expect(blocked.failure).toEqual({
      reason: "unsupported",
      retryable: false,
      attempts: 1,
      lastAttemptAt: 100,
    });
    expect(isChangeReadyToPush(blocked, Number.MAX_SAFE_INTEGER)).toBe(false);
    expect(isChangeReadyToPush(delayed, 30_099)).toBe(false);
    expect(isChangeReadyToPush(delayed, 30_100)).toBe(true);
    expect(retained).toHaveLength(2);
  });

  it("does not let a late failed request resurrect acknowledged changes or overwrite new edits", async () => {
    const original = await recordChange({
      entity: "notebook",
      entityId: "book",
      operation: "put",
      data: "original",
      timestamp: 1,
    });
    await markSynced([original.id]);
    await recordPushFailures([{ id: original.id, reason: "late failure" }]);
    await clearSyncedChanges();
    const newer = await recordChange({
      entity: "notebook",
      entityId: "book",
      operation: "put",
      data: "newer",
      timestamp: 2,
    });
    await recordPushFailures([{ id: original.id, reason: "even later failure" }]);
    expect(await getUnsyncedChanges()).toEqual([newer]);
  });
});
