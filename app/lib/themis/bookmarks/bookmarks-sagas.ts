import { call, cancel, fork, put, take, takeEvery } from "typed-redux-saga";

import { toTaggedError } from "~/lib/errors";
import { BookmarkService, type Bookmark } from "~/lib/stores/bookmark-store";
import {
  addBookmarkRequested,
  bookmarkAdded,
  bookmarkDeleted,
  bookmarkMutationFailed,
  bookmarksHydrateFailed,
  bookmarksHydrated,
  deleteBookmarkRequested,
  hydrateBookmarksRequested,
} from "~/lib/themis/bookmarks/bookmarks-slice";

async function loadBookmarks(bookId: string) {
  return BookmarkService.getBookmarksByBook(bookId);
}

async function persistBookmark(bookmark: Bookmark) {
  return BookmarkService.saveBookmark(bookmark);
}

async function persistBookmarkDeletion(bookmarkId: string) {
  return BookmarkService.deleteBookmark(bookmarkId);
}

export function* hydrateBookmarksSaga(action: ReturnType<typeof hydrateBookmarksRequested>) {
  const [bookId] = action.payload;
  try {
    const bookmarks = yield* call(loadBookmarks, bookId);
    yield* put(bookmarksHydrated(bookId, bookmarks));
  } catch (error) {
    yield* put(bookmarksHydrateFailed(bookId, toTaggedError(error)));
  }
}

export function* addBookmarkSaga(action: ReturnType<typeof addBookmarkRequested>) {
  const [bookmark] = action.payload;
  try {
    const saved = yield* call(persistBookmark, bookmark);
    yield* put(bookmarkAdded(saved));
  } catch (error) {
    yield* put(bookmarkMutationFailed(bookmark.bookId, toTaggedError(error)));
  }
}

export function* deleteBookmarkSaga(action: ReturnType<typeof deleteBookmarkRequested>) {
  const [bookId, bookmarkId] = action.payload;
  try {
    yield* call(persistBookmarkDeletion, bookmarkId);
    yield* put(bookmarkDeleted(bookId, bookmarkId));
  } catch (error) {
    yield* put(bookmarkMutationFailed(bookId, toTaggedError(error)));
  }
}

type BookmarkHydrateTask =
  ReturnType<
    typeof fork<Parameters<typeof hydrateBookmarksSaga>, typeof hydrateBookmarksSaga>
  > extends Generator<unknown, infer Task, unknown>
    ? Task
    : never;

export function* watchBookmarkHydrates() {
  const pendingByBookId = new Map<string, BookmarkHydrateTask>();
  while (true) {
    const action = yield* take(hydrateBookmarksRequested);
    const [bookId] = action.payload;
    const pending = pendingByBookId.get(bookId);
    if (pending) yield* cancel(pending);
    pendingByBookId.set(bookId, yield* fork(hydrateBookmarksSaga, action));
  }
}

export function* bookmarksSaga() {
  yield* fork(watchBookmarkHydrates);
  yield* takeEvery(addBookmarkRequested, addBookmarkSaga);
  yield* takeEvery(deleteBookmarkRequested, deleteBookmarkSaga);
}
