import { afterEach, describe, expect, it, vi } from "vitest";

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
  hydrateReadingPositionsRequested,
  readingPositionChanged,
  recordReadingHistoryRequested,
} from "~/lib/themis/reading-positions/reading-positions-slice";
import { createAppStore, type AppStore } from "~/lib/themis/store";

const stores: AppStore[] = [];

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
