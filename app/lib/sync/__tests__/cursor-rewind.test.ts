import { describe, it, expect, beforeEach, vi } from "vitest";
import { createStore, clear, get } from "idb-keyval";

vi.mock("../remap", () => ({
  remapBookId: vi.fn(async () => {}),
}));

import { rewindCursor } from "../sync-cursors";
import { mergeBookRecord, mergeChatSessionRecord } from "../sync-engine";

const bookStore = createStore("ebook-reader-db", "books");
const chatSessionStore = createStore("ebook-reader-chat-sessions", "sessions");

beforeEach(async () => {
  await Promise.all([clear(bookStore), clear(chatSessionStore)]);
  localStorage.clear();
});

describe("rewindCursor", () => {
  it("rewinds an ISO cursor by 1 millisecond", () => {
    const input = "2026-04-22T12:34:56.789Z";
    expect(rewindCursor(input)).toBe("2026-04-22T12:34:56.788Z");
  });

  it("rolls over seconds/minutes/hours/days cleanly", () => {
    expect(rewindCursor("2026-01-01T00:00:00.000Z")).toBe("2025-12-31T23:59:59.999Z");
  });

  it("returns the input unchanged when it does not parse as a date", () => {
    expect(rewindCursor("not-a-date")).toBe("not-a-date");
  });

  it("produces a cursor strictly less than the original (overlap window)", () => {
    const input = "2026-04-22T12:34:56.789Z";
    const rewound = rewindCursor(input);
    expect(Date.parse(rewound)).toBeLessThan(Date.parse(input));
    expect(Date.parse(input) - Date.parse(rewound)).toBe(1);
  });
});

describe("merger idempotency (covers overlap re-delivery)", () => {
  it("mergeBookRecord: applying the same record twice yields identical storage", async () => {
    const record = {
      id: "book-1",
      title: "T",
      author: "A",
      format: "epub",
      fileBlobUrl: "https://example.test/book.epub",
      coverBlobUrl: "https://example.test/cover.jpg",
      fileHash: "hash-1",
      updatedAt: "2026-04-22T12:00:00.000Z",
    };

    await mergeBookRecord(record);
    const afterFirst = await get<Record<string, unknown>>("book-1", bookStore);

    await mergeBookRecord(record);
    const afterSecond = await get<Record<string, unknown>>("book-1", bookStore);

    expect(afterSecond).toEqual(afterFirst);
  });

  it("mergeChatSessionRecord: applying the same session twice yields identical storage", async () => {
    const record = {
      id: "session-1",
      bookId: "book-1",
      title: "Chat",
      createdAt: "2026-04-22T12:00:00.000Z",
      updatedAt: "2026-04-22T12:00:00.000Z",
    };

    await mergeChatSessionRecord(record);
    const afterFirst = await get<unknown[]>("book-1", chatSessionStore);

    await mergeChatSessionRecord(record);
    const afterSecond = await get<unknown[]>("book-1", chatSessionStore);

    expect(afterSecond).toEqual(afterFirst);
    expect(afterFirst?.length).toBe(1);
  });

  it("mergeChatSessionRecord tombstone: re-delivery after local removal is a no-op", async () => {
    const tombstone = {
      id: "session-2",
      bookId: "book-2",
      title: "",
      createdAt: "2026-04-22T12:00:00.000Z",
      updatedAt: "2026-04-22T12:00:01.000Z",
      deletedAt: "2026-04-22T12:00:01.000Z",
    };

    await mergeChatSessionRecord(tombstone);
    const afterFirst = await get<unknown[]>("book-2", chatSessionStore);

    await mergeChatSessionRecord(tombstone);
    const afterSecond = await get<unknown[]>("book-2", chatSessionStore);

    expect(afterFirst).toBeUndefined();
    expect(afterSecond).toBeUndefined();
  });
});

describe("overlap-window scenario", () => {
  it("cursor stored after a pull is strictly before the last row's updatedAt", () => {
    const lastRowUpdatedAt = "2026-04-22T12:00:00.000Z";
    const storedCursor = rewindCursor(lastRowUpdatedAt);
    expect(Date.parse(storedCursor)).toBeLessThan(Date.parse(lastRowUpdatedAt));
  });

  it("re-delivering row A (from overlap) does not mutate storage beyond the single-apply state", async () => {
    const rowA = {
      id: "book-a",
      title: "A",
      author: "",
      format: "epub",
      fileHash: "h-a",
      updatedAt: "2026-04-22T12:00:00.000Z",
    };

    await mergeBookRecord(rowA);
    const afterFirstPull = await get<Record<string, unknown>>("book-a", bookStore);

    await mergeBookRecord(rowA);
    const afterSecondPull = await get<Record<string, unknown>>("book-a", bookStore);

    expect(afterSecondPull).toEqual(afterFirstPull);
  });
});
