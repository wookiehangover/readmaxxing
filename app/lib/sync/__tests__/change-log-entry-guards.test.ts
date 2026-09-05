import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangeEntry } from "../types";
import { clear, get, set } from "idb-keyval";
import { getChangeLogStore } from "../stores";

const entriesMock = vi.hoisted(() => vi.fn());

vi.mock("idb-keyval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("idb-keyval")>();
  return {
    ...actual,
    entries: entriesMock,
  };
});

const { getUnsyncedChanges, clearSyncedChanges } = await import("../change-log");

function makeChange(overrides: Partial<ChangeEntry> = {}): ChangeEntry {
  return {
    id: overrides.id ?? "01H00000000000000000000000",
    entity: overrides.entity ?? "book",
    entityId: overrides.entityId ?? "book-1",
    operation: overrides.operation ?? "put",
    data: overrides.data ?? {},
    timestamp: overrides.timestamp ?? 1,
    synced: overrides.synced ?? false,
  };
}

describe("change-log entry guards", () => {
  beforeEach(async () => {
    entriesMock.mockReset();
    await clear(getChangeLogStore());
  });

  it("getUnsyncedChanges skips malformed IDB entries", async () => {
    const unsynced = makeChange({ id: "01H00000000000000000000001" });
    entriesMock.mockResolvedValueOnce([
      undefined,
      ["string-value", "not-a-change"],
      ["missing-id", { synced: false }],
      ["non-string-id", { id: 123, synced: false }],
      ["synced", makeChange({ id: "01H00000000000000000000002", synced: true })],
      ["unsynced", unsynced],
    ]);

    await expect(getUnsyncedChanges()).resolves.toEqual([unsynced]);
  });

  it("clearSyncedChanges skips malformed IDB entries", async () => {
    const synced = makeChange({ id: "01H00000000000000000000003", synced: true });
    const stringSynced = { ...makeChange({ id: "01H00000000000000000000005" }), synced: "false" };
    const store = getChangeLogStore();
    await set("string-value", "not-a-change", store);
    await set("missing", undefined, store);
    await set("string-synced", stringSynced, store);
    await set("unsynced", makeChange({ id: "01H00000000000000000000004" }), store);
    await set("synced", synced, store);
    await expect(clearSyncedChanges()).resolves.toBe(1);
    expect(await get("synced", store)).toBeUndefined();
    expect(await get("string-synced", store)).toEqual(stringSynced);
    expect(await get("unsynced", store)).toMatchObject({ synced: false });
  });
});
