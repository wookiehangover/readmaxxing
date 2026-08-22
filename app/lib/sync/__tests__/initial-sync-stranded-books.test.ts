import { clear, createStore, set } from "idb-keyval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_BOOK_ID } from "~/lib/onboarding/demo-content";
import type { BookMeta } from "~/lib/stores/book-store";
import { getUnsyncedChanges, recordChange } from "../change-log";
import { runInitialSyncIfNeeded } from "../initial-sync";
import { pushChangesWithResult } from "../push";
import { getBookDataStore, getBookStore, getPositionStore, getSyncFlagsStore } from "../stores";
import type { SyncPushRequest } from "../types";

vi.mock("../file-uploads", () => ({
  uploadPendingFiles: vi.fn(async () => undefined),
}));

const INITIAL_SYNC_KEY = "initial-sync-complete";
const changeLogStore = createStore("ebook-reader-changelog", "changes");

function makeBook(id: string, overrides: Partial<BookMeta> = {}): BookMeta {
  return {
    id,
    title: `Book ${id}`,
    author: "Test author",
    coverImage: null,
    format: "epub",
    hasLocalFile: true,
    updatedAt: 1234,
    ...overrides,
  };
}

beforeEach(async () => {
  localStorage.clear();
  await Promise.all([
    clear(changeLogStore),
    clear(getBookStore()),
    clear(getBookDataStore()),
    clear(getPositionStore()),
    clear(getSyncFlagsStore()),
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runInitialSyncIfNeeded stranded-book recovery", () => {
  it("reconstructs a lost book change after initial sync and sends its metadata to the push API", async () => {
    const book = makeBook("stranded-book");
    await Promise.all([
      set(INITIAL_SYNC_KEY, true, getSyncFlagsStore()),
      set(book.id, book, getBookStore()),
      set(book.id, new ArrayBuffer(8), getBookDataStore()),
    ]);
    expect(await getUnsyncedChanges()).toEqual([]);

    await runInitialSyncIfNeeded();

    const pending = await getUnsyncedChanges();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      entity: "book",
      entityId: book.id,
      operation: "put",
      data: book,
      timestamp: book.updatedAt,
    });

    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as SyncPushRequest;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          accepted: body.changes.map((change) => ({ id: change.id })),
          rejected: [],
          serverTimestamp: new Date().toISOString(),
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await pushChangesWithResult({
      fileUploadContext: { userId: "user-test", uploadRetryState: new Map() },
      isStopped: () => false,
      scheduleFollowUpPush: () => {},
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sync/push",
      expect.objectContaining({ method: "POST" }),
    );
    const request = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as SyncPushRequest;
    expect(request.changes).toEqual([
      expect.objectContaining({ entity: "book", entityId: book.id, data: book }),
    ]);
    expect(await getUnsyncedChanges()).toEqual([]);
  });

  it("does not enqueue duplicates when the book already has a pending change", async () => {
    const book = makeBook("already-pending");
    await Promise.all([
      set(INITIAL_SYNC_KEY, true, getSyncFlagsStore()),
      set(book.id, book, getBookStore()),
      set(book.id, new ArrayBuffer(8), getBookDataStore()),
    ]);
    await recordChange({
      entity: "book",
      entityId: book.id,
      operation: "put",
      data: book,
      timestamp: book.updatedAt!,
    });

    await runInitialSyncIfNeeded();
    await runInitialSyncIfNeeded();

    expect(await getUnsyncedChanges()).toHaveLength(1);
  });

  it("skips uploaded, deleted, demo, and fileless books", async () => {
    const uploaded = makeBook("uploaded", { remoteFileUrl: "https://blob.test/book.epub" });
    const deleted = makeBook("deleted", { deletedAt: 5678 });
    const demo = makeBook(DEMO_BOOK_ID);
    const fileless = makeBook("fileless");
    await set(INITIAL_SYNC_KEY, true, getSyncFlagsStore());
    await Promise.all(
      [uploaded, deleted, demo, fileless].map((book) => set(book.id, book, getBookStore())),
    );
    await Promise.all(
      [uploaded, deleted, demo].map((book) => set(book.id, new ArrayBuffer(8), getBookDataStore())),
    );

    await runInitialSyncIfNeeded();

    expect(await getUnsyncedChanges()).toEqual([]);
  });

  it("does not repeat the historical non-book migration after its completion flag is set", async () => {
    await Promise.all([
      set(INITIAL_SYNC_KEY, true, getSyncFlagsStore()),
      set("book-with-position", { cfi: "chapter-1", updatedAt: 5678 }, getPositionStore()),
    ]);

    await runInitialSyncIfNeeded();

    expect(await getUnsyncedChanges()).toEqual([]);
  });
});
