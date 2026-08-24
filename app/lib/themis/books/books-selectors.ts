import { getItem, getItems } from "@augmentcode/themis/utils/collections/collection-utils";

import type { AppStoreCore } from "~/lib/themis/store";

export function createBooksSelectors(store: AppStoreCore) {
  return {
    selectAllBooks: store.createSelector((state) => getItems(state.books.collection)),
    selectBookById: store.createSelector((state, bookId: string) =>
      getItem(state.books.collection, bookId),
    ),
    selectBooksLoading: store.createSelector((state) => state.books.loading),
    selectBooksError: store.createSelector((state) => state.books.error),
    selectSeededDemoBookId: store.createSelector((state) => state.books.seededDemoBookId),
    selectDownloadingBookIds: store.createSelector((state) => state.books.downloadingBookIds),
    selectBookDownloadError: store.createSelector(
      (state, bookId: string) => state.books.downloadErrors[bookId] ?? null,
    ),
  };
}
