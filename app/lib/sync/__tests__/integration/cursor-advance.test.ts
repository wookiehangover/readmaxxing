import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clear, createStore } from "idb-keyval";
import { getCursor } from "../../sync-cursors";
import { makeSyncEngine } from "../../sync-engine";
import type { SyncPullResponse } from "../../types";

const bookStore = createStore("ebook-reader-db", "books");
const positionStore = createStore("ebook-reader-positions", "positions");
const cursorStore = createStore("ebook-reader-sync-cursors", "cursors");

beforeEach(async () => {
  await Promise.all([clear(bookStore), clear(positionStore), clear(cursorStore)]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Scenario 3: after a pull, the stored cursor equals
// `records[last].updatedAt - 1ms` (the overlap window from rewindCursor).
describe("integration: cursor advance rewinds 1ms", () => {
  it("stores each entity's cursor at T - 1ms after a pull that returned T", async () => {
    const T_BOOK = "2026-04-22T12:00:00.000Z";
    const T_POS = "2026-04-22T12:05:00.000Z";

    const response: SyncPullResponse = {
      serverTimestamp: T_POS,
      changes: [
        {
          entity: "book",
          records: [
            {
              id: "book-1",
              title: "A",
              author: "",
              format: "epub",
              fileHash: "h-1",
              updatedAt: T_BOOK,
            },
          ],
          cursor: T_BOOK,
          hasMore: false,
        },
        {
          entity: "position",
          records: [{ bookId: "book-1", cfi: "epubcfi(/6/2)", updatedAt: T_POS }],
          cursor: T_POS,
          hasMore: false,
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => response,
          }) as unknown as Response,
      ),
    );

    const engine = makeSyncEngine({ userId: "user-test" });
    await engine.pullChanges();

    const bookCursor = await getCursor("book");
    const posCursor = await getCursor("position");

    expect(bookCursor).not.toBeNull();
    expect(posCursor).not.toBeNull();

    // Cursor = group.cursor - 1ms so the server's `> since` filter still
    // surfaces sibling rows landing on the same millisecond.
    expect(Date.parse(bookCursor as string)).toBe(Date.parse(T_BOOK) - 1);
    expect(Date.parse(posCursor as string)).toBe(Date.parse(T_POS) - 1);
    expect(bookCursor).toBe(new Date(Date.parse(T_BOOK) - 1).toISOString());
    expect(posCursor).toBe(new Date(Date.parse(T_POS) - 1).toISOString());
  });
});
