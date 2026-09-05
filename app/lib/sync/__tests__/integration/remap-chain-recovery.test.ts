// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clear, entries, get, set } from "idb-keyval";
import { BASE, USER, OTHER_USER, db, push, routeFetch, ctx } from "./push-route-harness";
import { action } from "~/routes/api.sync.push";
import { loader } from "~/routes/api.sync.pull";
import { getUnsyncedChanges } from "../../change-log";
import { mergeBookRecord } from "../../entity-mergers";
import { pushChangesWithResult } from "../../push";
import { pullChanges } from "../../pull";
import { clearAllCursors } from "../../sync-cursors";
import { getBookRemaps, persistBookRemap, resumeBookRemaps } from "../../remap-journal";
import * as stores from "../../stores";
import type { ChangeEntry, SyncPullResponse, SyncPushRequest } from "../../types";

const book = (id: string, fileHash: string, offset = 0): ChangeEntry => ({
  id: `${id}-${offset}`,
  entity: "book",
  entityId: id,
  operation: "put",
  timestamp: BASE + offset,
  synced: false,
  data: { id, title: id, fileHash },
});
const notebook = (bookId: string, text: string, offset: number): ChangeEntry => ({
  id: `note-${bookId}-${offset}`,
  entity: "notebook",
  entityId: bookId,
  operation: "put",
  timestamp: BASE + offset,
  synced: false,
  data: {
    bookId,
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
  },
});
const queue = (change: ChangeEntry) => set(change.id, change, stores.getChangeLogStore());
beforeEach(async () => {
  await Promise.all(Object.values(stores).map((getter) => clear(getter())));
  await clearAllCursors();
});

async function evolvingServer() {
  await push([book("c", "hash1"), book("d", "hash2")], true);
  await queue(book("a", "hash1", 100));
  routeFetch();
  await pushChangesWithResult(ctx());
  expect(await getBookRemaps(USER)).toMatchObject([{ fromId: "a", toId: "c" }]);
  expect((await push([book("c", "hash2", 200)], true)).body.accepted[0].canonicalId).toBe("d");
}

describe("authoritative remap chain recovery", () => {
  it("accepts a later authoritative chain and recovers intermediate data without changing canonical metadata or clocks", async () => {
    await evolvingServer();
    const canonicalBefore = (await db.query("SELECT * FROM readmax.book WHERE id = 'd'")).rows;
    const oldNote = notebook("c", "surviving intermediate", 300);
    const newNote = notebook("d", "newer canonical", 500);
    await push([newNote], true);
    const canonicalBookmark = {
      id: "bookmark:d:page:7",
      bookId: "d",
      cfi: "page:7",
      pageNumber: 7,
      createdAt: BASE,
      updatedAt: BASE + 550,
      deletedAt: BASE + 550,
    };
    expect(
      (
        await push(
          [
            {
              id: "delete-bookmark",
              entity: "bookmark",
              entityId: canonicalBookmark.id,
              operation: "delete",
              timestamp: BASE + 550,
              synced: false,
              data: canonicalBookmark,
            },
          ],
          true,
        )
      ).body.rejected,
    ).toEqual([]);
    await set(canonicalBookmark.id, canonicalBookmark, stores.getBookmarkStore());
    await set(
      "bookmark:c:page:7",
      {
        ...canonicalBookmark,
        id: "bookmark:c:page:7",
        bookId: "c",
        updatedAt: BASE + 600,
        deletedAt: null,
      },
      stores.getBookmarkStore(),
    );
    await set(
      "c",
      { ...(oldNote.data as object), updatedAt: oldNote.timestamp },
      stores.getNotebookStore(),
    );
    await set(
      "d",
      { ...(newNote.data as object), updatedAt: newNote.timestamp },
      stores.getNotebookStore(),
    );
    await set("a", { cfi: "page:12", updatedAt: BASE + 350 }, stores.getPositionStore());
    await queue(book("a", "hash1", 600));
    const sent: ChangeEntry[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent.push(...(JSON.parse(init.body as string) as SyncPushRequest).changes);
      return action({ request: new Request("https://test/api/sync/push", init) });
    });
    for (let i = 0; i < 3; i++) await pushChangesWithResult(ctx());
    expect(await getUnsyncedChanges()).toEqual([]);
    expect(sent.filter((change) => change.entity === "book")).toMatchObject([
      { id: "a-600", entityId: "a" },
    ]);
    expect(sent).toContainEqual(
      expect.objectContaining({ entity: "notebook", entityId: "d", timestamp: BASE + 300 }),
    );
    expect(await get("c", stores.getNotebookStore())).toBeUndefined();
    expect(await get("d", stores.getNotebookStore())).toMatchObject({
      content: (newNote.data as { content: unknown }).content,
      updatedAt: BASE + 500,
    });
    expect(await get("a", stores.getPositionStore())).toBeUndefined();
    expect(await get("c", stores.getPositionStore())).toBeUndefined();
    expect(await get("d", stores.getPositionStore())).toMatchObject({
      cfi: "page:12",
      updatedAt: BASE + 350,
    });
    expect(await get("bookmark:c:page:7", stores.getBookmarkStore())).toBeUndefined();
    expect(await get("bookmark:d:page:7", stores.getBookmarkStore())).toEqual(canonicalBookmark);
    expect(
      (await db.query("SELECT id, deleted_at, mutation_at FROM readmax.bookmark")).rows,
    ).toEqual([
      {
        id: canonicalBookmark.id,
        deleted_at: new Date(BASE + 550),
        mutation_at: new Date(BASE + 550),
      },
    ]);
    expect((await db.query("SELECT * FROM readmax.book WHERE id = 'd'")).rows).toEqual(
      canonicalBefore,
    );
    expect(
      (await db.query("SELECT book_id, content, mutation_at FROM readmax.notebook")).rows,
    ).toEqual([
      {
        book_id: "d",
        content: (newNote.data as { content: unknown }).content,
        mutation_at: new Date(BASE + 500),
      },
    ]);
    expect((await db.query("SELECT book_id FROM readmax.reading_position")).rows).toEqual([
      { book_id: "d" },
    ]);
  });

  it("resumes after the chain extension commits but before root ACK, including delayed older responses", async () => {
    await evolvingServer();
    const note = notebook("c", "middle data", 300);
    await set(
      "c",
      { ...(note.data as object), updatedAt: note.timestamp },
      stores.getNotebookStore(),
    );
    const staleRoot = book("a", "hash1", 400);
    await queue(staleRoot);
    const journal = stores.getBookRemapStore();
    let interrupted = false;
    vi.spyOn(stores, "getBookRemapStore").mockReturnValue(async (mode, callback) => {
      const result = await journal(mode, callback);
      if (
        mode === "readwrite" &&
        !interrupted &&
        (await get<{ toId: string }>(JSON.stringify([USER, "c"]), journal))?.toId === "d"
      ) {
        interrupted = true;
        throw new Error("interrupted chain commit");
      }
      return result;
    });
    await expect(pushChangesWithResult(ctx())).rejects.toThrow("interrupted chain commit");
    expect(await getUnsyncedChanges()).toContainEqual(
      expect.objectContaining({ id: staleRoot.id, entityId: "a" }),
    );
    vi.restoreAllMocks();
    vi.resetModules();
    const reloadedJournal = await import("../../remap-journal");
    const reloadedPush = await import("../../push");
    for (let i = 0; i < 3; i++) {
      await reloadedJournal.persistBookRemap(USER, "a", "c");
      await reloadedJournal.persistBookRemap(USER, "a", "d");
      await reloadedPush.pushChangesWithResult(ctx());
    }
    expect(await getUnsyncedChanges()).toEqual([]);
    expect(await getBookRemaps(USER)).toMatchObject([
      { fromId: "a", toId: "c", complete: true },
      { fromId: "c", toId: "d", complete: true },
    ]);
    expect((await db.query("SELECT book_id, mutation_at FROM readmax.notebook")).rows).toEqual([
      { book_id: "d", mutation_at: new Date(BASE + 300) },
    ]);
  });

  it.each([false, true])(
    "consumes actual alias pull records in either order after reload (reversed: %s)",
    async (reverse) => {
      await evolvingServer();
      const note = notebook("c", "from intermediate", 300);
      await set(
        "c",
        { ...(note.data as object), updatedAt: note.timestamp },
        stores.getNotebookStore(),
      );
      vi.resetModules();
      vi.stubGlobal("window", { dispatchEvent: vi.fn() });
      vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
        const request = new Request(new URL(url, "https://test"), init);
        if (!url.startsWith("/api/sync/pull")) return action({ request });
        const response = await loader({ request });
        const body = (await response.json()) as SyncPullResponse;
        for (const group of body.changes) {
          if (group.entity === "book")
            group.records.sort(
              (a, b) =>
                String((a as { id: string }).id).localeCompare(String((b as { id: string }).id)) *
                (reverse ? -1 : 1),
            );
        }
        return Response.json(body);
      });
      await (await import("../../pull")).pullChanges({ userId: USER, isStopped: () => false });
      await (await import("../../push")).pushChangesWithResult(ctx());
      expect(await get("c", stores.getNotebookStore())).toBeUndefined();
      expect(await get("d", stores.getNotebookStore())).toMatchObject({
        bookId: "d",
        updatedAt: BASE + 300,
      });
      expect((await db.query("SELECT book_id FROM readmax.notebook")).rows).toEqual([
        { book_id: "d" },
      ]);
      await clear(stores.getNotebookStore());
      await clearAllCursors();
      await pullChanges({ userId: USER, isStopped: () => false });
      expect(await get("d", stores.getNotebookStore())).toMatchObject({
        bookId: "d",
        updatedAt: BASE + 300,
      });
    },
  );

  it("rejects cycles and foreign-owned evidence without changing pending data", async () => {
    await persistBookRemap(USER, "a", "c");
    await persistBookRemap(USER, "a", "d");
    const pending = notebook("c", "retained", 100);
    await queue(pending);
    const before = await entries(stores.getBookRemapStore());
    await expect(persistBookRemap(USER, "d", "a")).rejects.toThrow("Cyclic");
    await expect(
      mergeBookRecord({ id: "a", canonicalId: "d", userId: OTHER_USER }, { userId: USER }),
    ).rejects.toThrow("owner mismatch");
    expect(await entries(stores.getBookRemapStore())).toEqual(before);
    expect(await getUnsyncedChanges()).toEqual([pending]);
    await set(
      JSON.stringify([USER, "foreign"]),
      { ownerId: OTHER_USER, fromId: "foreign", toId: "d", complete: false },
      stores.getBookRemapStore(),
    );
    await expect(persistBookRemap(USER, "foreign", "d")).rejects.toThrow("owner mismatch");
    expect(await getUnsyncedChanges()).toEqual([pending]);
  });

  it("never follows another account's chain", async () => {
    await persistBookRemap(OTHER_USER, "d", "a");
    await persistBookRemap(USER, "a", "c");
    await persistBookRemap(USER, "a", "d");
    await queue(notebook("c", "owned", 100));
    await resumeBookRemaps(USER);
    expect(await getBookRemaps(OTHER_USER)).toEqual([
      { ownerId: OTHER_USER, fromId: "d", toId: "a", complete: false },
    ]);
    expect(await getUnsyncedChanges()).toMatchObject([
      { ownerId: USER, entityId: "d", timestamp: BASE + 100 },
    ]);
  });
});
