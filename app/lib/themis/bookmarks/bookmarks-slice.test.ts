import { getItem } from "@augmentcode/themis/utils/collections/collection-utils";
import { describe, expect, it } from "vitest";

import type { Bookmark } from "~/lib/stores/bookmark-store";
import {
  bookmarkAdded,
  bookmarkDeleted,
  bookmarksHydrated,
  bookmarksReducer,
} from "~/lib/themis/bookmarks/bookmarks-slice";

function makeBookmark(id: string, bookId = "book-1"): Bookmark {
  return { id, bookId, cfi: `epubcfi(${id})`, createdAt: 1 };
}

describe("bookmarksReducer", () => {
  it("hydrates one book without replacing another book's bookmarks", () => {
    const first = bookmarksReducer(
      undefined,
      bookmarksHydrated("book-2", [makeBookmark("other", "book-2")]),
    );
    const hydrated = bookmarksReducer(first, bookmarksHydrated("book-1", [makeBookmark("one")]));

    expect(getItem(hydrated.collection, "other")?.bookId).toBe("book-2");
    expect(getItem(hydrated.collection, "one")?.bookId).toBe("book-1");
    expect(JSON.parse(JSON.stringify(hydrated))).toEqual(hydrated);
  });

  it("adds and deletes bookmarks from the canonical collection", () => {
    const added = bookmarksReducer(undefined, bookmarkAdded(makeBookmark("one")));
    const deleted = bookmarksReducer(added, bookmarkDeleted("book-1", "one"));

    expect(getItem(added.collection, "one")).toEqual(makeBookmark("one"));
    expect(getItem(deleted.collection, "one")).toBeUndefined();
  });

  it("preserves unknown-action identity", () => {
    const state = bookmarksReducer(undefined, bookmarkAdded(makeBookmark("one")));
    expect(bookmarksReducer(state, { type: "unknown" })).toBe(state);
  });
});
