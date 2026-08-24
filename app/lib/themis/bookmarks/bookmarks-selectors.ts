import { filterItems } from "@augmentcode/themis/utils/collections/collection-utils";

import type { Bookmark } from "~/lib/stores/bookmark-store";
import type { AppStoreCore } from "~/lib/themis/store";

export function createBookmarksSelectors(store: AppStoreCore) {
  return {
    selectBookmarksByBook: store.createSelector((state, bookId: string) =>
      filterItems(
        state.bookmarks.collection,
        (bookmark): bookmark is Bookmark => bookmark.bookId === bookId,
      ),
    ),
    selectBookmarksLoading: store.createSelector((state, bookId: string) =>
      state.bookmarks.loadingBookIds.includes(bookId),
    ),
    selectBookmarksLoaded: store.createSelector((state, bookId: string) =>
      state.bookmarks.loadedBookIds.includes(bookId),
    ),
    selectBookmarksError: store.createSelector(
      (state, bookId: string) => state.bookmarks.errorsByBookId[bookId] ?? null,
    ),
  };
}
