import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clear, get, set } from "idb-keyval";
import {
  getUnsyncedChanges,
  markSynced,
  recordChange,
  recordPushFailures,
  clearSyncedChanges,
} from "../../change-log";
import { pushChangesWithResult } from "../../push";
import { getBookRemaps, persistBookRemap, resumeBookRemaps } from "../../remap-journal";
import * as remapRecords from "../../remap-records";
import { getDefaultRemapStores } from "../../remap";
import * as stores from "../../stores";
import type { ChangeEntry, SyncPushRequest } from "../../types";

vi.mock("../../file-uploads", () => ({ uploadPendingFiles: async () => {} }));

const context = () => ({
  fileUploadContext: { userId: "remap-user", uploadRetryState: new Map() },
  isStopped: () => false,
  scheduleFollowUpPush: vi.fn(),
});

async function seedChange(
  id: string,
  entity: ChangeEntry["entity"],
  entityId: string,
  data: unknown,
  overrides: Partial<ChangeEntry> = {},
) {
  const change: ChangeEntry = {
    id,
    entity,
    entityId,
    data,
    operation: "put",
    timestamp: 100,
    synced: false,
    ...overrides,
  };
  await set(id, change, stores.getChangeLogStore());
  return change;
}

beforeEach(async () => {
  await Promise.all(Object.values(stores).map((getStore) => clear(getStore())));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function acceptingServer() {
  const batches: ChangeEntry[][] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const { changes } = JSON.parse(init.body) as SyncPushRequest;
      batches.push(changes);
      return Response.json({
        accepted: changes.map((change) => ({
          id: change.id,
          ...(change.entity === "book" && change.entityId === "local"
            ? { canonicalId: "canonical" }
            : {}),
        })),
        rejected: [],
      });
    }),
  );
  return batches;
}

describe("remap retries and stale producers", () => {
  it("retains distinct same-clock local and queued notebook snapshots during a canonical tie", async () => {
    await seedChange("001", "notebook", "local", {
      bookId: "local",
      content: { text: "queued" },
      updatedAt: 100,
    });
    await set(
      "local",
      { bookId: "local", content: { text: "distinct local" }, updatedAt: 100 },
      stores.getNotebookStore(),
    );
    await set(
      "canonical",
      { bookId: "canonical", content: { text: "canonical tie" }, updatedAt: 100 },
      stores.getNotebookStore(),
    );
    await persistBookRemap("remap-user", "local", "canonical");
    await resumeBookRemaps("remap-user");
    expect((await getUnsyncedChanges()).map((change) => change.data)).toEqual(
      expect.arrayContaining([
        { bookId: "canonical", content: { text: "queued" }, updatedAt: 100 },
        { bookId: "canonical", content: { text: "distinct local" }, updatedAt: 100 },
      ]),
    );
    expect(await get("canonical", stores.getNotebookStore())).toMatchObject({
      content: { text: "canonical tie" },
      updatedAt: 100,
    });
  });

  it("rewrites >50 entries across batches plus later puts/deletes, preserving retained permanent failures", async () => {
    await seedChange("000", "book", "local", { id: "local" });
    for (let i = 1; i <= 120; i++) {
      await seedChange(String(i).padStart(3, "0"), "highlight", `h${i}`, {
        id: `h${i}`,
        bookId: "local",
        text: String(i),
      });
    }
    const permanent = await seedChange("999", "bookmark", "bookmark:local:page:1", {
      id: "bookmark:local:page:1",
      bookId: "local",
      label: "local",
    });
    await recordPushFailures(
      [{ id: permanent.id, reason: "invalid label", retryable: false }],
      1000,
    );
    const failure = (await getUnsyncedChanges()).find(
      (change) => change.id === permanent.id,
    )!.failure;
    const batches = acceptingServer();
    await expect(pushChangesWithResult(context())).rejects.toThrow("retained");
    const firstRewritten = await getUnsyncedChanges();
    expect(firstRewritten).toHaveLength(121);
    expect(firstRewritten.map((change) => change.id)).toEqual(
      Array.from({ length: 120 }, (_, i) => String(i + 1).padStart(3, "0")).concat("999"),
    );
    expect(firstRewritten.find((change) => change.id === "999")).toMatchObject({
      entityId: "bookmark:canonical:page:1",
      failure,
    });
    await seedChange(
      "121",
      "notebook",
      "local",
      { bookId: "local", content: { text: "later local" } },
      { timestamp: 200 },
    );
    await seedChange(
      "122",
      "bookmark",
      "bookmark:local:page:2",
      { id: "bookmark:local:page:2", bookId: "local", deletedAt: 300 },
      { operation: "delete", timestamp: 300 },
    );
    for (let i = 0; i < 3; i++)
      await expect(pushChangesWithResult(context())).rejects.toThrow("retained");
    expect(batches.map((batch) => batch.length)).toEqual([50, 50, 50, 22]);
    expect(
      batches
        .slice(1)
        .flat()
        .every((change) => !JSON.stringify(change.data).includes('"bookId":"local"')),
    ).toBe(true);
    expect(batches.flat().find((change) => change.id === "122")).toMatchObject({
      entityId: "bookmark:canonical:page:2",
      operation: "delete",
      timestamp: 300,
    });
    expect(await getUnsyncedChanges()).toEqual([expect.objectContaining({ id: "999", failure })]);
  });

  it("retains canonical replacements against old acknowledgments and delayed failure completions after reload", async () => {
    const original = await seedChange("001", "notebook", "local", {
      bookId: "local",
      content: { text: "saved" },
    });
    await persistBookRemap("remap-user", "local", "canonical");
    await resumeBookRemaps("remap-user");
    vi.resetModules();
    const reloaded = await import("../../change-log");
    await reloaded.markSynced([original.id], [original]);
    await reloaded.recordPushFailures(
      [{ id: original.id, reason: "late permanent failure", retryable: false }],
      2000,
      [original],
    );
    await reloaded.clearSyncedChanges();
    const [replacement] = await reloaded.getUnsyncedChanges();
    expect(replacement).toMatchObject({
      id: original.id,
      entityId: "canonical",
      timestamp: 100,
      synced: false,
      revision: 1,
      ownerId: "remap-user",
    });
    expect(replacement.failure).toBeUndefined();
    await reloaded.markSynced([replacement.id], [replacement]);
    await reloaded.recordPushFailures([{ id: original.id, reason: "later" }], 3000, [replacement]);
    await reloaded.clearSyncedChanges();
    expect(await reloaded.getUnsyncedChanges()).toEqual([]);
  });

  it("rescans a source rewritten by a stale producer during migration before publishing the remap", async () => {
    await set(
      "local",
      { bookId: "local", content: { text: "first" }, updatedAt: 100 },
      stores.getNotebookStore(),
    );
    await persistBookRemap("remap-user", "local", "canonical");
    const actual = remapRecords.moveRemapRecord;
    let written = false;
    vi.spyOn(remapRecords, "moveRemapRecord").mockImplementation(async (...args) => {
      const result = await actual(...args);
      if (!written && args[0] === getDefaultRemapStores().notebookStore) {
        written = true;
        const newer = { bookId: "local", content: { text: "during move" }, updatedAt: 200 };
        await set("local", newer, stores.getNotebookStore());
        await recordChange({
          entity: "notebook",
          entityId: "local",
          operation: "put",
          data: newer,
          timestamp: 200,
        });
      }
      return result;
    });
    const observed: Promise<unknown>[] = [];
    const listener = (event: Event) => {
      if ((event as CustomEvent).detail.bookIdRemap)
        observed.push(get("canonical", stores.getNotebookStore()));
    };
    window.addEventListener("sync:entity-updated", listener);
    try {
      await resumeBookRemaps("remap-user");
      expect(await get("local", stores.getNotebookStore())).toBeUndefined();
      expect(await get("canonical", stores.getNotebookStore())).toMatchObject({
        bookId: "canonical",
        content: { text: "during move" },
        updatedAt: 200,
      });
      expect(await Promise.all(observed)).toEqual([
        expect.objectContaining({ content: { text: "during move" } }),
      ]);
      expect((await getUnsyncedChanges()).every((change) => change.entityId === "canonical")).toBe(
        true,
      );
    } finally {
      window.removeEventListener("sync:entity-updated", listener);
    }
  });

  it("keeps completed aliases for stale producers, including snapshotless deletes and unrelated literal IDs", async () => {
    await persistBookRemap("remap-user", "local", "canonical");
    await resumeBookRemaps("remap-user");
    await seedChange("001", "bookmark", "bookmark:local:cfi:part", null, { operation: "delete" });
    await seedChange("002", "notebook", "local", {
      bookId: "local",
      content: { type: "doc", text: "local", attrs: { id: "local", bookId: "local" } },
    });
    await seedChange("003", "highlight", "local", {
      id: "local",
      bookId: "different",
      text: "local",
    });
    await seedChange("004", "settings", "local", { bookId: "local" });
    await seedChange(
      "005",
      "book",
      "local",
      { id: "local", deletedAt: 999 },
      { operation: "delete" },
    );
    await set(
      "local",
      { bookId: "local", content: { text: "stale producer saved" }, updatedAt: 123 },
      stores.getNotebookStore(),
    );
    const batches = acceptingServer();
    await pushChangesWithResult(context());
    const changes = batches.flat();
    expect(changes.find((change) => change.id === "001")).toMatchObject({
      entityId: "bookmark:canonical:cfi:part",
      data: null,
      operation: "delete",
    });
    expect(changes.find((change) => change.id === "002")?.data).toEqual({
      bookId: "canonical",
      content: { type: "doc", text: "local", attrs: { id: "local", bookId: "local" } },
    });
    expect(changes.find((change) => change.id === "003")).toMatchObject({
      entityId: "local",
      data: { id: "local", bookId: "different", text: "local" },
    });
    expect(changes.find((change) => change.id === "004")).toMatchObject({
      entityId: "local",
      data: { bookId: "local" },
    });
    expect(changes.find((change) => change.id === "005")).toMatchObject({
      entityId: "local",
      operation: "delete",
    });
    expect(await get("canonical", stores.getNotebookStore())).toMatchObject({
      content: { text: "stale producer saved" },
      updatedAt: 123,
    });
    expect(await getBookRemaps("remap-user")).toEqual([
      { ownerId: "remap-user", fromId: "local", toId: "canonical", complete: true },
    ]);
  });

  it("does not resume another account's journal or acknowledge its remapped outbox", async () => {
    await persistBookRemap("account-a", "local", "canonical-a");
    await seedChange(
      "001",
      "notebook",
      "local",
      { bookId: "local", content: { text: "A" } },
      { ownerId: "account-a" },
    );
    await set(
      "local",
      { bookId: "local", content: { text: "A" }, updatedAt: 100 },
      stores.getNotebookStore(),
    );
    const batches = acceptingServer();
    await pushChangesWithResult(context());
    expect(batches).toHaveLength(0);
    expect(await get("local", stores.getNotebookStore())).toMatchObject({ content: { text: "A" } });
    expect(await getBookRemaps("account-a")).toMatchObject([{ complete: false }]);
    await resumeBookRemaps("account-a");
    await pushChangesWithResult(context());
    expect(batches).toHaveLength(0);
    expect(await getUnsyncedChanges()).toMatchObject([
      { entityId: "canonical-a", ownerId: "account-a" },
    ]);
    await seedChange("002", "notebook", "local", {
      bookId: "local",
      content: { text: "late A producer" },
    });
    await seedChange("003", "position", "canonical-a", { cfi: "page:12" });
    await pushChangesWithResult(context());
    expect(batches).toHaveLength(0);
    expect((await getUnsyncedChanges()).every((change) => change.ownerId === "account-a")).toBe(
      true,
    );
  });

  it("does not persist an old account's response after the engine stops", async () => {
    const original = await seedChange("001", "book", "local", {});
    let stopped = false;
    vi.stubGlobal("fetch", async () => {
      stopped = true;
      return Response.json({
        accepted: [{ id: original.id, canonicalId: "canonical" }],
        rejected: [],
      });
    });
    await pushChangesWithResult({ ...context(), isStopped: () => stopped });
    expect(await getBookRemaps("remap-user")).toEqual([]);
    expect(await getUnsyncedChanges()).toEqual([original]);
  });

  it("keeps the identity evidence after an acknowledged source book is cleared", async () => {
    const original = await seedChange("001", "book", "local", {});
    await persistBookRemap("remap-user", "local", "canonical");
    await markSynced([original.id], [original]);
    await clearSyncedChanges();
    vi.resetModules();
    const reloaded = await import("../../push");
    await seedChange(
      "002",
      "position",
      "local",
      { cfi: "page:20", updatedAt: 200 },
      { timestamp: 200 },
    );
    const batches = acceptingServer();
    await reloaded.pushChangesWithResult(context());
    expect(batches.flat()).toMatchObject([{ id: "002", entityId: "canonical", timestamp: 200 }]);
    expect(await getBookRemaps("remap-user")).toMatchObject([{ complete: true }]);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("durable remap outbox integration", () => {
  it("republishes same-batch dependent writes accepted by a server without alias handling", async () => {
    await seedChange("001", "book", "local", { id: "local", fileHash: "hash" });
    await seedChange("002", "notebook", "local", {
      bookId: "local",
      content: { text: "local stays literal" },
      updatedAt: 100,
    });
    await seedChange("003", "highlight", "highlight", {
      id: "highlight",
      bookId: "local",
      text: "local",
      updatedAt: 100,
    });
    await seedChange("004", "position", "local", { cfi: "page:12", updatedAt: 100 });
    const sent: SyncPushRequest[] = [];
    const server = new Map<string, ChangeEntry>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body) as SyncPushRequest;
        sent.push(body);
        for (const change of body.changes)
          server.set(`${change.entity}:${change.entityId}`, change);
        return Response.json({
          accepted: body.changes.map((change) => ({
            id: change.id,
            ...(change.entity === "book" && change.entityId === "local"
              ? { canonicalId: "canonical" }
              : {}),
          })),
          rejected: [],
        });
      }),
    );
    await pushChangesWithResult(context());
    expect(await getUnsyncedChanges()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "002",
          entityId: "canonical",
          timestamp: 100,
          synced: false,
        }),
        expect.objectContaining({
          id: "003",
          data: expect.objectContaining({ bookId: "canonical", text: "local" }),
        }),
        expect.objectContaining({ id: "004", entityId: "canonical" }),
      ]),
    );
    await pushChangesWithResult(context());
    expect(await getUnsyncedChanges()).toEqual([]);
    expect(server.get("notebook:canonical")?.data).toMatchObject({
      bookId: "canonical",
      content: { text: "local stays literal" },
    });
    expect(server.get("position:canonical")?.data).toMatchObject({ cfi: "page:12" });
    expect(server.get("highlight:highlight")?.data).toMatchObject({ bookId: "canonical" });
    expect(sent).toHaveLength(2);
    expect(await get("canonical", stores.getNotebookStore())).toBeUndefined();
  });
});
