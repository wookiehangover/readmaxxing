import {
  addItems,
  createCollection,
  filterCollection,
  removeItem,
  upsertItem,
} from "@augmentcode/themis/utils/collections/collection-utils";
import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

import type { TaggedError } from "~/lib/errors";
import type { Bookmark } from "~/lib/stores/bookmark-store";
import type { BookmarksState } from "~/lib/themis/bookmarks/bookmarks-types";

export const hydrateBookmarksRequested = createAction<[bookId: string]>(
  "bookmarks/hydrateRequested",
);
export const bookmarksHydrated =
  createAction<[bookId: string, bookmarks: Bookmark[]]>("bookmarks/hydrated");
export const bookmarksHydrateFailed =
  createAction<[bookId: string, error: TaggedError]>("bookmarks/hydrateFailed");
export const addBookmarkRequested = createAction<[bookmark: Bookmark]>("bookmarks/addRequested");
export const bookmarkAdded = createAction<[bookmark: Bookmark]>("bookmarks/bookmarkAdded");
export const deleteBookmarkRequested = createAction<[bookId: string, bookmarkId: string]>(
  "bookmarks/deleteRequested",
);
export const bookmarkDeleted = createAction<[bookId: string, bookmarkId: string]>(
  "bookmarks/bookmarkDeleted",
);
export const bookmarkMutationFailed = createAction<[bookId: string, error: TaggedError]>(
  "bookmarks/mutationFailed",
);

export const bookmarksInitialState: BookmarksState = {
  collection: createCollection<Bookmark, "id">("id"),
  loadingBookIds: [],
  loadedBookIds: [],
  errorsByBookId: {},
};

const reducer = createReducer<BookmarksState>(bookmarksInitialState);

reducer.with(hydrateBookmarksRequested, (state, { payload: [bookId] }) => {
  const { [bookId]: _, ...errorsByBookId } = state.errorsByBookId;
  return {
    ...state,
    loadingBookIds: state.loadingBookIds.includes(bookId)
      ? state.loadingBookIds
      : [...state.loadingBookIds, bookId],
    errorsByBookId,
  };
});
reducer.with(bookmarksHydrated, (state, { payload: [bookId, bookmarks] }) => {
  const otherBookmarks = filterCollection(
    state.collection,
    (bookmark): bookmark is Bookmark => bookmark.bookId !== bookId,
  );
  const { [bookId]: _, ...errorsByBookId } = state.errorsByBookId;
  return {
    ...state,
    collection: addItems(otherBookmarks, bookmarks),
    loadingBookIds: state.loadingBookIds.filter((id) => id !== bookId),
    loadedBookIds: state.loadedBookIds.includes(bookId)
      ? state.loadedBookIds
      : [...state.loadedBookIds, bookId],
    errorsByBookId,
  };
});
reducer.with(bookmarksHydrateFailed, (state, { payload: [bookId, error] }) => ({
  ...state,
  loadingBookIds: state.loadingBookIds.filter((id) => id !== bookId),
  errorsByBookId: { ...state.errorsByBookId, [bookId]: error },
}));
reducer.with(bookmarkAdded, (state, { payload: [bookmark] }) => {
  const { [bookmark.bookId]: _, ...errorsByBookId } = state.errorsByBookId;
  return {
    ...state,
    collection: upsertItem(state.collection, bookmark),
    errorsByBookId,
  };
});
reducer.with(bookmarkDeleted, (state, { payload: [bookId, bookmarkId] }) => {
  const { [bookId]: _, ...errorsByBookId } = state.errorsByBookId;
  return {
    ...state,
    collection: removeItem(state.collection, bookmarkId),
    errorsByBookId,
  };
});
reducer.with(bookmarkMutationFailed, (state, { payload: [bookId, error] }) => ({
  ...state,
  errorsByBookId: { ...state.errorsByBookId, [bookId]: error },
}));

export const bookmarksReducer = reducer;
