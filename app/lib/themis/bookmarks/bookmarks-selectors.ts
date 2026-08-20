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
    selectBookmarksError: store.createSelector(
      (state, bookId: string) => state.bookmarks.errorsByBookId[bookId] ?? null,
    ),
  };
}
