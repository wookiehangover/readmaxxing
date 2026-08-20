import { afterEach, describe, expect, it, vi } from "vitest";

import type { Bookmark } from "~/lib/stores/bookmark-store";

const mocks = vi.hoisted(() => ({ runPromise: vi.fn() }));

vi.mock("~/lib/stores/bookmark-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/stores/bookmark-store")>();
  return {
    ...actual,
    BookmarkService: new Proxy(actual.BookmarkService, { get: () => mocks.runPromise }),
  };
});

import { bookmarksSaga } from "~/lib/themis/bookmarks/bookmarks-sagas";
import {
  addBookmarkRequested,
  deleteBookmarkRequested,
  hydrateBookmarksRequested,
} from "~/lib/themis/bookmarks/bookmarks-slice";
import { createAppStore, type AppStore } from "~/lib/themis/store";

const stores: AppStore[] = [];

function makeBookmark(): Bookmark {
  return {
    id: "bookmark-1",
    bookId: "book-1",
    cfi: "epubcfi(/6/4)",
    createdAt: 1,
    updatedAt: 1,
  };
}

function startStore() {
  const store = createAppStore();
  stores.push(store);
  store.init();
  store.runSaga(bookmarksSaga);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  mocks.runPromise.mockReset();
  vi.restoreAllMocks();
});

describe("bookmarksSaga", () => {
  it("hydrates bookmarks from persistence", async () => {
    const bookmark = makeBookmark();
    mocks.runPromise.mockResolvedValueOnce([bookmark]);
    const store = startStore();

    store.dispatch(hydrateBookmarksRequested("book-1"));

    await vi.waitFor(() =>
      expect(store.bookmarksSelectors.selectBookmarksByBook.select(store.state, "book-1")).toEqual([
        bookmark,
      ]),
    );
    expect(mocks.runPromise).toHaveBeenCalledOnce();
  });

  it("adds and deletes only after persistence succeeds", async () => {
    const bookmark = { ...makeBookmark(), updatedAt: undefined };
    const persisted = { ...bookmark, updatedAt: 1_234 };
    mocks.runPromise.mockResolvedValueOnce(persisted).mockResolvedValueOnce(undefined);
    const store = startStore();

    store.dispatch(addBookmarkRequested(bookmark));
    await vi.waitFor(() =>
      expect(store.bookmarksSelectors.selectBookmarksByBook.select(store.state, "book-1")).toEqual([
        persisted,
      ]),
    );
    const [selected] = store.bookmarksSelectors.selectBookmarksByBook.select(store.state, "book-1");
    expect(selected).toBe(persisted);
    expect(selected.updatedAt).toBe(1_234);

    store.dispatch(deleteBookmarkRequested("book-1", bookmark.id));
    await vi.waitFor(() =>
      expect(store.bookmarksSelectors.selectBookmarksByBook.select(store.state, "book-1")).toEqual(
        [],
      ),
    );
  });

  it("keeps failed writes out of the collection", async () => {
    mocks.runPromise.mockRejectedValueOnce(new Error("IDB unavailable"));
    const store = startStore();

    store.dispatch(addBookmarkRequested(makeBookmark()));

    await vi.waitFor(() =>
      expect(store.bookmarksSelectors.selectBookmarksError.select(store.state, "book-1")).toBe(
        "IDB unavailable",
      ),
    );
    expect(store.bookmarksSelectors.selectBookmarksByBook.select(store.state, "book-1")).toEqual(
      [],
    );
  });
});
