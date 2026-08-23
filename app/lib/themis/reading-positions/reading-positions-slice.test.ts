import { getItem } from "@augmentcode/themis/utils/collections/collection-utils";
import { describe, expect, it } from "vitest";

import type { ReadingHistoryEntry } from "~/lib/stores/reading-history-store";
import {
  locationCacheHydrated,
  readingHistoryHydrated,
  readingPositionsHydrated,
  readingPositionsReducer,
  remoteReadingPositionChecked,
} from "~/lib/themis/reading-positions/reading-positions-slice";
import { createAppStore } from "~/lib/themis/store";

const historyEntry: ReadingHistoryEntry = {
  id: "history-1",
  bookId: "book-1",
  cfi: "epubcfi(/6/4)",
  chapterHref: "chapter.xhtml",
  chapterLabel: "Chapter",
  percentage: 25,
  pageIndex: 2,
  totalPages: 8,
  timestamp: 1,
};

function selectPositionNudge({
  localCfi = "epubcfi(/6/4)",
  localUpdatedAt = 10,
  remoteCfi,
  remoteUpdatedAt = 1,
  history = [],
}: {
  localCfi?: string;
  localUpdatedAt?: number;
  remoteCfi: string | null;
  remoteUpdatedAt?: number;
  history?: ReadingHistoryEntry[];
}) {
  let readingPositions = readingPositionsReducer(
    undefined,
    readingPositionsHydrated(
      ["book-1"],
      [{ key: "book-1", cfi: localCfi, updatedAt: localUpdatedAt }],
    ),
  );
  if (history.length > 0) {
    readingPositions = readingPositionsReducer(
      readingPositions,
      readingHistoryHydrated("book-1", history),
    );
  }
  if (remoteCfi !== null) {
    readingPositions = readingPositionsReducer(
      readingPositions,
      remoteReadingPositionChecked("book-1", {
        bookId: "book-1",
        cfi: remoteCfi,
        updatedAt: remoteUpdatedAt,
      }),
    );
  }

  const store = createAppStore();
  store.init({ readingPositions });
  const nudge = store.readingPositionsSelectors.selectPositionNudge.select(store.state, "book-1");
  store.dispose();
  return nudge;
}

describe("readingPositionsReducer", () => {
  it("hydrates positions by key without replacing unrelated records", () => {
    const first = readingPositionsReducer(
      undefined,
      readingPositionsHydrated(["book-2"], [{ key: "book-2", cfi: "page:2", updatedAt: 1 }]),
    );
    const hydrated = readingPositionsReducer(
      first,
      readingPositionsHydrated(["book-1"], [{ key: "book-1", cfi: "page:7", updatedAt: 2 }]),
    );

    expect(getItem(hydrated.positions, "book-2")?.cfi).toBe("page:2");
    expect(getItem(hydrated.positions, "book-1")?.cfi).toBe("page:7");
    expect(JSON.parse(JSON.stringify(hydrated))).toEqual(hydrated);
  });

  it("normalizes location caches, history, and remote position facts", () => {
    const withCache = readingPositionsReducer(
      undefined,
      locationCacheHydrated("book-1", '{"version":1}'),
    );
    const withHistory = readingPositionsReducer(
      withCache,
      readingHistoryHydrated("book-1", [historyEntry]),
    );
    const state = readingPositionsReducer(
      withHistory,
      remoteReadingPositionChecked("book-1", {
        bookId: "book-1",
        cfi: "epubcfi(/6/8)",
        updatedAt: 3,
      }),
    );

    expect(getItem(state.locationCaches, "book-1")?.json).toBe('{"version":1}');
    expect(getItem(state.history, historyEntry.id)).toEqual(historyEntry);
    expect(getItem(state.remotePositions, "book-1")?.updatedAt).toBe(3);
    expect(readingPositionsReducer(state, { type: "unknown" })).toBe(state);
  });

  it("replaces repeatedly hydrated history only for the requested book", () => {
    const otherBookEntry = { ...historyEntry, id: "history-2", bookId: "book-2" };
    const replacementEntry = { ...historyEntry, id: "history-3", cfi: "epubcfi(/6/8)" };
    const withOtherBook = readingPositionsReducer(
      undefined,
      readingHistoryHydrated("book-2", [otherBookEntry]),
    );
    const firstHydration = readingPositionsReducer(
      withOtherBook,
      readingHistoryHydrated("book-1", [historyEntry]),
    );
    const repeatedHydration = readingPositionsReducer(
      firstHydration,
      readingHistoryHydrated("book-1", [replacementEntry]),
    );

    expect(getItem(repeatedHydration.history, historyEntry.id)).toBeUndefined();
    expect(getItem(repeatedHydration.history, replacementEntry.id)).toEqual(replacementEntry);
    expect(getItem(repeatedHydration.history, otherBookEntry.id)).toEqual(otherBookEntry);
  });

  it("derives remote nudges from canonical local and remote positions", () => {
    const store = createAppStore();
    store.init({
      readingPositions: readingPositionsReducer(
        readingPositionsReducer(
          undefined,
          readingPositionsHydrated(
            ["book-1"],
            [{ key: "book-1", cfi: "epubcfi(/6/4)", updatedAt: 1 }],
          ),
        ),
        remoteReadingPositionChecked("book-1", {
          bookId: "book-1",
          cfi: "epubcfi(/6/8)",
          updatedAt: 2,
        }),
      ),
    });

    expect(
      store.readingPositionsSelectors.selectPositionNudge.select(store.state, "book-1")?.cfi,
    ).toBe("epubcfi(/6/8)");
    store.dispose();
  });

  it("nudges for a content-further remote even when its timestamp is older", () => {
    expect(
      selectPositionNudge({
        localUpdatedAt: 10,
        remoteCfi: "epubcfi(/6/8)",
        remoteUpdatedAt: 1,
      })?.cfi,
    ).toBe("epubcfi(/6/8)");
  });

  it("does not nudge when the remote position is missing, equal, or earlier", () => {
    expect(selectPositionNudge({ remoteCfi: null })).toBeNull();
    expect(selectPositionNudge({ remoteCfi: "epubcfi(/6/4)" })).toBeNull();
    expect(selectPositionNudge({ remoteCfi: "epubcfi(/6/2)" })).toBeNull();
    expect(selectPositionNudge({ localCfi: "page:5", remoteCfi: "page:5" })).toBeNull();
    expect(selectPositionNudge({ localCfi: "page:5", remoteCfi: "page:4" })).toBeNull();
  });

  it("does not nudge after the user intentionally backtracked from the remote position", () => {
    expect(
      selectPositionNudge({
        remoteCfi: "epubcfi(/6/8)",
        history: [{ ...historyEntry, cfi: "epubcfi(/6/8)" }],
      }),
    ).toBeNull();
    expect(
      selectPositionNudge({
        remoteCfi: "epubcfi(/6/8)",
        history: [{ ...historyEntry, cfi: "epubcfi(/6/10)" }],
      }),
    ).toBeNull();
  });
});
