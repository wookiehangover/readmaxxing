import { filterItems, getItem } from "@augmentcode/themis/utils/collections/collection-utils";

import type { Highlight } from "~/lib/stores/annotations-store";
import type { AppStoreCore } from "~/lib/themis/store";

export function createAnnotationsSelectors(store: AppStoreCore) {
  return {
    selectHighlightsByBook: store.createSelector((state, bookId: string) =>
      filterItems(
        state.annotations.highlights,
        (highlight): highlight is Highlight => highlight.bookId === bookId,
      ),
    ),
    selectHighlightById: store.createSelector((state, highlightId: string) =>
      getItem(state.annotations.highlights, highlightId),
    ),
    selectNotebookByBookId: store.createSelector((state, bookId: string) =>
      getItem(state.annotations.notebooks, bookId),
    ),
    selectAnnotationsLoaded: store.createSelector((state, bookId: string) =>
      state.annotations.loadedBookIds.includes(bookId),
    ),
    selectAnnotationsError: store.createSelector(
      (state, bookId: string) => state.annotations.errorsByBookId[bookId] ?? null,
    ),
  };
}
