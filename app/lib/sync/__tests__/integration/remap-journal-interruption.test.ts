import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clear, get, set, type UseStore } from "idb-keyval";
import * as storeGetters from "../../stores";
import * as remap from "../../remap";
import { getBookRemaps } from "../../remap-journal";
import { getUnsyncedChanges } from "../../change-log";
import { pushChangesWithResult } from "../../push";
import type { ChangeEntry, SyncPushRequest } from "../../types";

vi.mock("../../file-uploads", () => ({ uploadPendingFiles: async () => {} }));
const ctx = {
  fileUploadContext: { userId: "owner", uploadRetryState: new Map() },
  isStopped: () => false,
  scheduleFollowUpPush: () => {},
};

beforeEach(async () => {
  await Promise.all(Object.values(storeGetters).map((getter) => clear(getter())));
  await clear(remap.getDefaultRemapStores().chapterUploadCacheStore!);
  const stores = remap.getDefaultRemapStores();
  const notebook = { bookId: "local", content: { text: "original" }, updatedAt: 100 };
  const highlight = { id: "h", bookId: "local", text: "highlight", updatedAt: 100 };
  const bookmark = { id: "bookmark:local:page:1", bookId: "local", label: "live", updatedAt: 100 };
  const position = { cfi: "page:12", updatedAt: 100 };
  const session = {
    id: "s",
    bookId: "local",
    title: "original",
    updatedAt: 100,
    messages: [{ id: "m", content: "preserved message", createdAt: 99 }],
  };
  await Promise.all([
    set("local", { id: "local", title: "Alias title", updatedAt: 300 }, stores.bookStore),
    set(
      "canonical",
      { id: "canonical", title: "Canonical title", deletedAt: 200, updatedAt: 200 },
      stores.bookStore,
    ),
    set("local", new ArrayBuffer(8), stores.bookDataStore),
    set("local", position, stores.positionStore),
    set("canonical", { cfi: "page:5", updatedAt: 200 }, stores.positionStore),
    set("local", { cfi: "page:9", updatedAt: 100 }, stores.remotePositionStore!),
    set("local", notebook, stores.notebookStore),
    set(
      "canonical",
      { bookId: "canonical", content: { text: "newer" }, updatedAt: 200 },
      stores.notebookStore,
    ),
    set("h", highlight, stores.highlightStore),
    set(bookmark.id, bookmark, stores.bookmarkStore),
    set(
      "bookmark:canonical:page:1",
      { id: "bookmark:canonical:page:1", bookId: "canonical", deletedAt: 50, updatedAt: 50 },
      stores.bookmarkStore,
    ),
    set("local", [session], stores.chatSessionStore),
    set(
      "canonical",
      [
        {
          ...session,
          bookId: "canonical",
          title: "newer",
          updatedAt: 200,
          messages: [{ id: "other", content: "other message", createdAt: 1 }],
        },
      ],
      stores.chatSessionStore,
    ),
    set("local", "s", stores.activeSessionStore),
    set("local", 3, stores.chapterUploadCacheStore!),
  ]);
  const inputs: Array<[ChangeEntry["entity"], string, unknown]> = [
    ["book", "local", { id: "local", title: "Alias title", updatedAt: 300 }],
    ["notebook", "local", notebook],
    ["highlight", "h", highlight],
    ["position", "local", position],
    ["bookmark", bookmark.id, bookmark],
    ["chat_session", session.id, session],
  ];
  for (const [i, [entity, entityId, data]] of inputs.entries()) {
    const id = String(i).padStart(3, "0");
    await set(
      id,
      { id, entity, entityId, data, operation: "put", timestamp: 100, synced: false },
      storeGetters.getChangeLogStore(),
    );
  }
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const { changes } = JSON.parse(init.body as string) as SyncPushRequest;
    return Response.json({
      accepted: changes.map((change) => ({
        id: change.id,
        ...(change.entity === "book" && change.entityId === "local"
          ? { canonicalId: "canonical" }
          : {}),
      })),
      rejected: [],
    });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type MoveStore = keyof remap.RemapStores;
const interruptions: Array<[string, number]> = [
  ["journal", 1],
  ["journal", 2],
  ["chapterUploadCacheStore", 2],
  ...Array.from({ length: 13 }, (_, i): [string, number] => ["outbox", i + 1]),
  ...[
    "bookDataStore",
    "positionStore",
    "remotePositionStore",
    "notebookStore",
    "highlightStore",
    "bookmarkStore",
    "chatSessionStore",
    "activeSessionStore",
    "chapterUploadCacheStore",
    "bookStore",
  ].map((key): [string, number] => [key, 1]),
];

describe("remap journal crash boundaries", () => {
  it("keeps every original mutation when the journal cannot commit", async () => {
    const original = await getUnsyncedChanges();
    const journalStore = storeGetters.getBookRemapStore();
    vi.spyOn(storeGetters, "getBookRemapStore").mockReturnValue(async (mode, callback) => {
      if (mode === "readwrite") throw new Error("journal quota failure");
      return journalStore(mode, callback);
    });
    await expect(pushChangesWithResult(ctx)).rejects.toThrow("journal quota failure");
    expect(await getUnsyncedChanges()).toEqual(original);
    vi.restoreAllMocks();
    await pushChangesWithResult(ctx);
    await pushChangesWithResult(ctx);
    expect(await getUnsyncedChanges()).toEqual([]);
  });

  it("aborts a bookmark write without deleting either source or canonical tombstone", async () => {
    const realStores = remap.getDefaultRemapStores();
    const aborted: UseStore = (mode, callback) =>
      realStores.bookmarkStore(mode, (store) => {
        const result = callback(store);
        if (mode === "readwrite") store.transaction.abort();
        return result;
      });
    vi.spyOn(remap, "getDefaultRemapStores").mockReturnValue({
      ...realStores,
      bookmarkStore: aborted,
    });
    await expect(pushChangesWithResult(ctx)).rejects.toThrow();
    expect(await get("bookmark:local:page:1", realStores.bookmarkStore)).toMatchObject({
      label: "live",
    });
    expect(await get("bookmark:canonical:page:1", realStores.bookmarkStore)).toMatchObject({
      deletedAt: 50,
    });
    vi.restoreAllMocks();
    await pushChangesWithResult(ctx);
    expect(await get("bookmark:local:page:1", realStores.bookmarkStore)).toBeUndefined();
    expect(await get("bookmark:canonical:page:1", realStores.bookmarkStore)).toMatchObject({
      deletedAt: 50,
    });
  });

  it.each(interruptions)(
    "recovers after committed %s write %i and module reload",
    async (target, occurrence) => {
      const realStores = remap.getDefaultRemapStores();
      let writes = 0;
      let interrupted = false;
      const wrap =
        (store: UseStore): UseStore =>
        async (mode, callback) => {
          const result = await store(mode, callback);
          if (mode === "readwrite" && ++writes === occurrence) {
            interrupted = true;
            throw new Error("simulated process interruption");
          }
          return result;
        };
      if (target === "journal") {
        const wrapped = wrap(storeGetters.getBookRemapStore());
        vi.spyOn(storeGetters, "getBookRemapStore").mockReturnValue(wrapped);
      } else if (target === "outbox") {
        const wrapped = wrap(storeGetters.getChangeLogStore());
        vi.spyOn(storeGetters, "getChangeLogStore").mockReturnValue(wrapped);
      } else {
        const injected = { ...realStores, [target]: wrap(realStores[target as MoveStore]!) };
        vi.spyOn(remap, "getDefaultRemapStores").mockReturnValue(injected);
      }
      await expect(pushChangesWithResult(ctx)).rejects.toThrow("simulated process interruption");
      expect(interrupted).toBe(true);
      expect(await getBookRemaps("owner")).toMatchObject([
        { fromId: "local", toId: "canonical", ownerId: "owner" },
      ]);
      vi.restoreAllMocks();
      vi.resetModules();
      const notifications: unknown[] = [];
      vi.stubGlobal("window", {
        dispatchEvent: (event: CustomEvent) => notifications.push(event.detail),
      });
      const reloadedPush = await import("../../push");
      for (let i = 0; i < 3; i++) await reloadedPush.pushChangesWithResult(ctx);
      expect(await getUnsyncedChanges()).toEqual([]);
      expect(await getBookRemaps("owner")).toMatchObject([{ complete: true }]);
      expect(notifications).toContainEqual({
        entity: "book",
        bookIdRemap: { fromId: "local", toId: "canonical" },
      });
      expect(await get("local", realStores.bookDataStore)).toBeUndefined();
      expect((await get<ArrayBuffer>("canonical", realStores.bookDataStore))?.byteLength).toBe(8);
      expect(await get("canonical", realStores.bookStore)).toMatchObject({
        title: "Canonical title",
        deletedAt: 200,
        updatedAt: 200,
      });
      expect(await get("local", realStores.bookStore)).toMatchObject({
        canonicalId: "canonical",
        updatedAt: 300,
      });
      expect(await get("canonical", realStores.notebookStore)).toMatchObject({
        content: { text: "newer" },
        updatedAt: 200,
      });
      expect(await get("canonical", realStores.positionStore)).toMatchObject({
        cfi: "page:12",
        updatedAt: 100,
      });
      expect(await get("canonical", realStores.remotePositionStore!)).toMatchObject({
        cfi: "page:9",
      });
      expect(await get("h", realStores.highlightStore)).toMatchObject({ bookId: "canonical" });
      expect(await get("bookmark:local:page:1", realStores.bookmarkStore)).toBeUndefined();
      expect(await get("bookmark:canonical:page:1", realStores.bookmarkStore)).toMatchObject({
        deletedAt: 50,
      });
      const sessions = await get<Array<{ title: string; messages: unknown[] }>>(
        "canonical",
        realStores.chatSessionStore,
      );
      expect(sessions?.[0]).toMatchObject({
        title: "newer",
        messages: expect.arrayContaining([
          expect.objectContaining({ id: "m" }),
          expect.objectContaining({ id: "other" }),
        ]),
      });
      expect(await get("canonical", realStores.activeSessionStore)).toBe("s");
      expect(await get("canonical", realStores.chapterUploadCacheStore!)).toBe(3);
    },
  );
});
