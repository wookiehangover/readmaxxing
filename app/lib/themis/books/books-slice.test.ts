import { getItem, getItems } from "@augmentcode/themis/utils/collections/collection-utils";
import { describe, expect, it } from "vitest";

import type { BookMeta } from "~/lib/stores/book-store";
import {
  bookAdded,
  bookDeleted,
  bookDownloadCompleted,
  bookDownloadFailed,
  bookUpdated,
  booksHydrateFailed,
  booksHydrated,
  booksReducer,
  hydrateBooks,
  downloadBookForOpenRequested,
} from "~/lib/themis/books/books-slice";

function makeBook(id: string, title = `Book ${id}`): BookMeta {
  return { id, title, author: "Author", coverImage: null, format: "epub" };
}

describe("booksReducer", () => {
  it("hydrates an empty collection", () => {
    const loading = booksReducer(undefined, hydrateBooks());
    const hydrated = booksReducer(loading, booksHydrated([]));

    expect(getItems(hydrated.collection)).toEqual([]);
    expect(hydrated.loading).toBe(false);
    expect(hydrated.error).toBeNull();
  });

  it("hydrates several books keyed by id", () => {
    const books = [makeBook("one"), makeBook("two"), makeBook("three")];
    const state = booksReducer(undefined, booksHydrated(books));

    expect(state.collection.ids).toEqual(["one", "two", "three"]);
    expect(getItem(state.collection, "two")).toEqual(books[1]);
  });

  it("upserts added and updated books and removes deleted books", () => {
    const added = booksReducer(undefined, bookAdded(makeBook("one")));
    const updated = booksReducer(added, bookUpdated(makeBook("one", "Updated")));
    const deleted = booksReducer(updated, bookDeleted("one"));

    expect(getItem(updated.collection, "one")?.title).toBe("Updated");
    expect(getItem(deleted.collection, "one")).toBeUndefined();
  });

  it("records hydrate failures", () => {
    const loading = booksReducer(undefined, hydrateBooks());
    const failed = booksReducer(loading, booksHydrateFailed("IDB unavailable"));

    expect(failed.loading).toBe(false);
    expect(failed.error).toBe("IDB unavailable");
  });

  it("tracks loading and errors for one downloaded book", () => {
    const requested = booksReducer(
      undefined,
      downloadBookForOpenRequested(
        "one",
        async () => {},
        () => {},
      ),
    );
    const failed = booksReducer(requested, bookDownloadFailed("one", "network unavailable"));
    const retried = booksReducer(
      failed,
      downloadBookForOpenRequested(
        "one",
        async () => {},
        () => {},
      ),
    );
    const completed = booksReducer(retried, bookDownloadCompleted("one"));

    expect(requested.downloadingBookIds).toEqual(["one"]);
    expect(failed.downloadErrors).toEqual({ one: "network unavailable" });
    expect(retried.downloadErrors).toEqual({});
    expect(completed.downloadingBookIds).toEqual([]);
  });
});
