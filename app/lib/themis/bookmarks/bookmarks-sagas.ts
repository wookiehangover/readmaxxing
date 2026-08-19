import { Effect } from "effect";
import { call, put, takeEvery } from "typed-redux-saga";

import { AppRuntime } from "~/lib/effect-runtime";
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
  return AppRuntime.runPromise(
    BookmarkService.pipe(Effect.andThen((service) => service.getBookmarksByBook(bookId))),
  );
}

async function persistBookmark(bookmark: Bookmark) {
  await AppRuntime.runPromise(
    BookmarkService.pipe(Effect.andThen((service) => service.saveBookmark(bookmark))),
  );
  return bookmark;
}

async function persistBookmarkDeletion(bookmarkId: string) {
  return AppRuntime.runPromise(
    BookmarkService.pipe(Effect.andThen((service) => service.deleteBookmark(bookmarkId))),
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function* hydrateBookmarksSaga(action: ReturnType<typeof hydrateBookmarksRequested>) {
  const [bookId] = action.payload;
  try {
    const bookmarks = yield* call(loadBookmarks, bookId);
    yield* put(bookmarksHydrated(bookId, bookmarks));
  } catch (error) {
    yield* put(bookmarksHydrateFailed(bookId, errorMessage(error)));
  }
}

export function* addBookmarkSaga(action: ReturnType<typeof addBookmarkRequested>) {
  const [bookmark] = action.payload;
  try {
    const saved = yield* call(persistBookmark, bookmark);
    yield* put(bookmarkAdded(saved));
  } catch (error) {
    yield* put(bookmarkMutationFailed(bookmark.bookId, errorMessage(error)));
  }
}

export function* deleteBookmarkSaga(action: ReturnType<typeof deleteBookmarkRequested>) {
  const [bookId, bookmarkId] = action.payload;
  try {
    yield* call(persistBookmarkDeletion, bookmarkId);
    yield* put(bookmarkDeleted(bookId, bookmarkId));
  } catch (error) {
    yield* put(bookmarkMutationFailed(bookId, errorMessage(error)));
  }
}

export function* bookmarksSaga() {
  yield* takeEvery(hydrateBookmarksRequested, hydrateBookmarksSaga);
  yield* takeEvery(addBookmarkRequested, addBookmarkSaga);
  yield* takeEvery(deleteBookmarkRequested, deleteBookmarkSaga);
}
