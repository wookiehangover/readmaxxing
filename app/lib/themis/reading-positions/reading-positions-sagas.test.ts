import { afterEach, describe, expect, it, vi } from "vitest";

import { ReadingHistoryError } from "~/lib/errors";
import type { ReadingHistoryEntry } from "~/lib/stores/reading-history-store";

const mocks = vi.hoisted(() => ({
  getRemotePositionRecord: vi.fn(),
  runPromise: vi.fn(),
}));

vi.mock("~/lib/stores/remote-position-store", () => ({
  getRemotePositionRecord: mocks.getRemotePositionRecord,
}));
vi.mock("~/lib/stores/position-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/stores/position-store")>();
  return {
    ...actual,
    ReadingPositionService: new Proxy(actual.ReadingPositionService, {
      get: () => mocks.runPromise,
    }),
  };
});
vi.mock("~/lib/stores/location-cache-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/stores/location-cache-store")>();
  return {
    ...actual,
    LocationCacheService: new Proxy(actual.LocationCacheService, { get: () => mocks.runPromise }),
  };
});
vi.mock("~/lib/stores/reading-history-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/stores/reading-history-store")>();
  return {
    ...actual,
    ReadingHistoryService: new Proxy(actual.ReadingHistoryService, { get: () => mocks.runPromise }),
  };
});

import { readingPositionsSaga } from "~/lib/themis/reading-positions/reading-positions-sagas";
import {
  checkPositionNudgeRequested,
  flushReadingPositionRequested,
  hydrateLocationCacheRequested,
  hydrateReadingHistoryRequested,
  hydrateReadingPositionsRequested,
  readingPositionChanged,
  recordReadingHistoryRequested,
} from "~/lib/themis/reading-positions/reading-positions-slice";
import { createAppStore, type AppStore } from "~/lib/themis/store";

const stores: AppStore[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function startStore() {
  const store = createAppStore();
  stores.push(store);
  store.init();
  store.runSaga(readingPositionsSaga);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  mocks.getRemotePositionRecord.mockReset();
  mocks.runPromise.mockReset();
});

describe("readingPositionsSaga", () => {
  it("hydrates book and panel positions from persistence", async () => {
    mocks.runPromise
      .mockResolvedValueOnce({ cfi: "page:4", updatedAt: 1 })
      .mockResolvedValueOnce({ cfi: "page:6", updatedAt: 2 });
    const completed = vi.fn();
    const store = startStore();

    store.dispatch(hydrateReadingPositionsRequested(["book-1", "panel-1"], completed));

    await vi.waitFor(() => expect(completed).toHaveBeenCalledOnce());
    expect(store.readingPositionsSelectors.selectPosition.select(store.state, "book-1")?.cfi).toBe(
      "page:4",
    );
    expect(store.readingPositionsSelectors.selectPosition.select(store.state, "panel-1")?.cfi).toBe(
      "page:6",
    );
  });

  it("keeps the latest overlapping hydrate result for a key", async () => {
    const olderPosition = deferred<{ cfi: string; updatedAt: number }>();
    mocks.runPromise
      .mockReturnValueOnce(olderPosition.promise)
      .mockResolvedValueOnce({ cfi: "page:9", updatedAt: 2 });
    const store = startStore();

    store.dispatch(hydrateReadingPositionsRequested(["book-1"]));
    await vi.waitFor(() => expect(mocks.runPromise).toHaveBeenCalledOnce());
    store.dispatch(hydrateReadingPositionsRequested(["book-1"]));

    await vi.waitFor(() =>
      expect(
        store.readingPositionsSelectors.selectPosition.select(store.state, "book-1")?.cfi,
      ).toBe("page:9"),
    );
    olderPosition.resolve({ cfi: "page:2", updatedAt: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.readingPositionsSelectors.selectPosition.select(store.state, "book-1")?.cfi).toBe(
      "page:9",
    );
  });

  it("keeps unrelated panel keys and settles callbacks across overlapping hydrates", async () => {
    const olderBook = deferred<{ cfi: string; updatedAt: number }>();
    const olderPanel = deferred<{ cfi: string; updatedAt: number }>();
    mocks.runPromise
      .mockReturnValueOnce(olderBook.promise)
      .mockReturnValueOnce(olderPanel.promise)
      .mockResolvedValueOnce({ cfi: "page:9", updatedAt: 9 })
      .mockResolvedValueOnce({ cfi: "page:8", updatedAt: 8 });
    const olderCompleted = vi.fn();
    const olderFailed = vi.fn();
    const newerCompleted = vi.fn();
    const newerFailed = vi.fn();
    const store = startStore();

    store.dispatch(
      hydrateReadingPositionsRequested(["book-1", "panel-a"], olderCompleted, olderFailed),
    );
    await vi.waitFor(() => expect(mocks.runPromise).toHaveBeenCalledTimes(2));
    store.dispatch(
      hydrateReadingPositionsRequested(["book-1", "panel-b"], newerCompleted, newerFailed),
    );

    await vi.waitFor(() => expect(newerCompleted).toHaveBeenCalledOnce());
    olderBook.resolve({ cfi: "page:2", updatedAt: 2 });
    olderPanel.resolve({ cfi: "page:3", updatedAt: 3 });
    await vi.waitFor(() => expect(olderCompleted).toHaveBeenCalledOnce());

    expect(store.readingPositionsSelectors.selectPosition.select(store.state, "book-1")?.cfi).toBe(
      "page:9",
    );
    expect(store.readingPositionsSelectors.selectPosition.select(store.state, "panel-a")?.cfi).toBe(
      "page:3",
    );
    expect(store.readingPositionsSelectors.selectPosition.select(store.state, "panel-b")?.cfi).toBe(
      "page:8",
    );
    expect(olderFailed).not.toHaveBeenCalled();
    expect(newerFailed).not.toHaveBeenCalled();
  });

  it("settles a superseded hydrate through its failure callback", async () => {
    const olderPosition = deferred<{ cfi: string; updatedAt: number }>();
    mocks.runPromise
      .mockReturnValueOnce(olderPosition.promise)
      .mockResolvedValueOnce({ cfi: "page:9", updatedAt: 9 });
    const olderCompleted = vi.fn();
    const olderFailed = vi.fn();
    const newerCompleted = vi.fn();
    const store = startStore();

    store.dispatch(hydrateReadingPositionsRequested(["book-1"], olderCompleted, olderFailed));
    await vi.waitFor(() => expect(mocks.runPromise).toHaveBeenCalledOnce());
    store.dispatch(hydrateReadingPositionsRequested(["book-1"], newerCompleted));
    await vi.waitFor(() => expect(newerCompleted).toHaveBeenCalledOnce());

    olderPosition.reject(new Error("older hydrate failed"));
    await vi.waitFor(() => expect(olderFailed).toHaveBeenCalledWith("older hydrate failed"));

    expect(olderCompleted).not.toHaveBeenCalled();
    expect(store.readingPositionsSelectors.selectPosition.select(store.state, "book-1")?.cfi).toBe(
      "page:9",
    );
  });

  it("persists before updating the position collection", async () => {
    mocks.runPromise
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ cfi: "page:9", updatedAt: 3 })
      .mockResolvedValueOnce({ cfi: "page:9", updatedAt: 3 });
    const store = startStore();

    store.dispatch(
      flushReadingPositionRequested({ bookId: "book-1", panelId: "panel-1", cfi: "page:9" }),
    );

    await vi.waitFor(() =>
      expect(
        store.readingPositionsSelectors.selectPosition.select(store.state, "book-1")?.cfi,
      ).toBe("page:9"),
    );
    expect(mocks.runPromise).toHaveBeenCalledTimes(4);
  });

  it("persists changed positions locally before the debounced sync write", async () => {
    for (let pass = 0; pass < 2; pass += 1) {
      mocks.runPromise
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ cfi: "page:5", updatedAt: pass + 1 })
        .mockResolvedValueOnce({ cfi: "page:5", updatedAt: pass + 1 });
    }
    const store = startStore();

    store.dispatch(readingPositionChanged({ bookId: "book-1", panelId: "panel-1", cfi: "page:5" }));

    await vi.waitFor(() =>
      expect(
        store.readingPositionsSelectors.selectPosition.select(store.state, "book-1")?.cfi,
      ).toBe("page:5"),
    );
    await vi.waitFor(() => expect(mocks.runPromise).toHaveBeenCalledTimes(8), { timeout: 2000 });
  });

  it("hydrates persisted reading history without recording a new visit", async () => {
    const entry: ReadingHistoryEntry = {
      id: "history-1",
      bookId: "book-1",
      cfi: "epubcfi(/6/4)",
      chapterHref: "chapter.xhtml",
      chapterLabel: "Chapter",
      percentage: 20,
      pageIndex: 2,
      totalPages: 10,
      timestamp: 1,
    };
    mocks.runPromise.mockResolvedValueOnce([entry]);
    const store = startStore();

    store.dispatch(hydrateReadingHistoryRequested("book-1"));

    await vi.waitFor(() =>
      expect(
        store.readingPositionsSelectors.selectReadingHistory.select(store.state, "book-1"),
      ).toEqual([entry]),
    );
    expect(mocks.runPromise).toHaveBeenCalledExactlyOnceWith("book-1");
  });

  it("keeps the latest overlapping reading-history hydrate for each book", async () => {
    const older: ReadingHistoryEntry = {
      id: "older-history",
      bookId: "book-1",
      cfi: "epubcfi(/6/4)",
      chapterHref: "chapter.xhtml",
      chapterLabel: "Chapter",
      percentage: 20,
      pageIndex: 2,
      totalPages: 10,
      timestamp: 1,
    };
    const newer = { ...older, id: "newer-history", cfi: "epubcfi(/6/8)", timestamp: 2 };
    const otherBook = { ...older, id: "other-history", bookId: "book-2" };
    const olderRequest = deferred<ReadingHistoryEntry[]>();
    const otherBookRequest = deferred<ReadingHistoryEntry[]>();
    mocks.runPromise
      .mockReturnValueOnce(olderRequest.promise)
      .mockReturnValueOnce(otherBookRequest.promise)
      .mockResolvedValueOnce([newer]);
    const store = startStore();

    store.dispatch(hydrateReadingHistoryRequested("book-1"));
    store.dispatch(hydrateReadingHistoryRequested("book-2"));
    await vi.waitFor(() => expect(mocks.runPromise).toHaveBeenCalledTimes(2));
    store.dispatch(hydrateReadingHistoryRequested("book-1"));

    await vi.waitFor(() =>
      expect(
        store.readingPositionsSelectors.selectReadingHistory.select(store.state, "book-1"),
      ).toEqual([newer]),
    );
    otherBookRequest.resolve([otherBook]);
    await vi.waitFor(() =>
      expect(
        store.readingPositionsSelectors.selectReadingHistory.select(store.state, "book-2"),
      ).toEqual([otherBook]),
    );
    olderRequest.resolve([older]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      store.readingPositionsSelectors.selectReadingHistory.select(store.state, "book-1"),
    ).toEqual([newer]);
  });

  it("ignores a stale history hydrate after recording a newer visit", async () => {
    const staleHistory = deferred<ReadingHistoryEntry[]>();
    const recorded: ReadingHistoryEntry = {
      id: "recorded-history",
      bookId: "book-1",
      cfi: "epubcfi(/6/8)",
      chapterHref: "chapter.xhtml",
      chapterLabel: "Chapter",
      percentage: 40,
      pageIndex: 4,
      totalPages: 10,
      timestamp: 2,
    };
    mocks.runPromise
      .mockReturnValueOnce(staleHistory.promise)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([recorded]);
    const store = startStore();

    store.dispatch(hydrateReadingHistoryRequested("book-1"));
    await vi.waitFor(() => expect(mocks.runPromise).toHaveBeenCalledOnce());
    store.dispatch(
      recordReadingHistoryRequested("book-1", {
        cfi: recorded.cfi,
        chapterHref: recorded.chapterHref,
        chapterLabel: recorded.chapterLabel,
        percentage: recorded.percentage,
        pageIndex: recorded.pageIndex,
        totalPages: recorded.totalPages,
      }),
    );

    await vi.waitFor(() =>
      expect(
        store.readingPositionsSelectors.selectReadingHistory.select(store.state, "book-1"),
      ).toEqual([recorded]),
    );
    staleHistory.resolve([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      store.readingPositionsSelectors.selectReadingHistory.select(store.state, "book-1"),
    ).toEqual([recorded]);
  });

  it("records reading-history hydration failures without replacing existing history", async () => {
    const entry: ReadingHistoryEntry = {
      id: "history-1",
      bookId: "book-1",
      cfi: "epubcfi(/6/4)",
      chapterHref: "chapter.xhtml",
      chapterLabel: "Chapter",
      percentage: 20,
      pageIndex: 2,
      totalPages: 10,
      timestamp: 1,
    };
    mocks.runPromise
      .mockResolvedValueOnce([entry])
      .mockRejectedValueOnce(
        new ReadingHistoryError({ operation: "getHistory", bookId: "book-1" }),
      );
    const store = startStore();

    store.dispatch(hydrateReadingHistoryRequested("book-1"));
    await vi.waitFor(() =>
      expect(
        store.readingPositionsSelectors.selectReadingHistory.select(store.state, "book-1"),
      ).toEqual([entry]),
    );
    store.dispatch(hydrateReadingHistoryRequested("book-1"));

    await vi.waitFor(() =>
      expect(
        store.readingPositionsSelectors.selectReadingPositionError.select(store.state, "book-1"),
      ).toEqual({
        _tag: "ReadingHistoryError",
        message: "ReadingHistoryError",
        operation: "getHistory",
        bookId: "book-1",
      }),
    );
    expect(
      store.readingPositionsSelectors.selectReadingHistory.select(store.state, "book-1"),
    ).toEqual([entry]);
  });

  it("hydrates location caches and persists history into normalized state", async () => {
    const entry: ReadingHistoryEntry = {
      id: "history-1",
      bookId: "book-1",
      cfi: "epubcfi(/6/4)",
      chapterHref: "chapter.xhtml",
      chapterLabel: "Chapter",
      percentage: 20,
      pageIndex: 2,
      totalPages: 10,
      timestamp: 1,
    };
    mocks.runPromise
      .mockResolvedValueOnce("cached-locations")
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([entry]);
    const store = startStore();

    store.dispatch(hydrateLocationCacheRequested("book-1"));
    await vi.waitFor(() =>
      expect(
        store.readingPositionsSelectors.selectLocationCache.select(store.state, "book-1")?.json,
      ).toBe("cached-locations"),
    );
    store.dispatch(
      recordReadingHistoryRequested("book-1", {
        cfi: entry.cfi,
        chapterHref: entry.chapterHref,
        chapterLabel: entry.chapterLabel,
        percentage: entry.percentage,
        pageIndex: entry.pageIndex,
        totalPages: entry.totalPages,
      }),
    );
    await vi.waitFor(() =>
      expect(
        store.readingPositionsSelectors.selectReadingHistory.select(store.state, "book-1"),
      ).toEqual([entry]),
    );
  });

  it("loads remote and local position facts for the nudge selector", async () => {
    mocks.getRemotePositionRecord.mockResolvedValueOnce({
      cfi: "epubcfi(/6/8)",
      updatedAt: 2,
    });
    mocks.runPromise.mockResolvedValueOnce({ cfi: "epubcfi(/6/4)", updatedAt: 1 });
    const store = startStore();

    store.dispatch(checkPositionNudgeRequested("book-1"));

    await vi.waitFor(() =>
      expect(
        store.readingPositionsSelectors.selectPositionNudge.select(store.state, "book-1")?.cfi,
      ).toBe("epubcfi(/6/8)"),
    );
  });
});
