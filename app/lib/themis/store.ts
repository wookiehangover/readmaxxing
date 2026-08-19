import { ReactStore } from "@augmentcode/themis/react-store";

import { createAnnotationsSelectors } from "~/lib/themis/annotations/annotations-selectors";
import { annotationsReducer } from "~/lib/themis/annotations/annotations-slice";
import type { AnnotationsState } from "~/lib/themis/annotations/annotations-types";
import { createBookmarksSelectors } from "~/lib/themis/bookmarks/bookmarks-selectors";
import { bookmarksReducer } from "~/lib/themis/bookmarks/bookmarks-slice";
import type { BookmarksState } from "~/lib/themis/bookmarks/bookmarks-types";
import type { BooksState } from "~/lib/themis/books/books-slice";
import { createBooksSelectors } from "~/lib/themis/books/books-selectors";
import { booksReducer } from "~/lib/themis/books/books-slice";
import { createReadingPositionsSelectors } from "~/lib/themis/reading-positions/reading-positions-selectors";
import { readingPositionsReducer } from "~/lib/themis/reading-positions/reading-positions-slice";
import type { ReadingPositionsState } from "~/lib/themis/reading-positions/reading-positions-types";
import { createWorkspaceRestoreSelectors } from "~/lib/themis/workspace-restore/workspace-restore-selectors";
import { workspaceRestoreReducer } from "~/lib/themis/workspace-restore/workspace-restore-slice";
import type { WorkspaceRestoreState } from "~/lib/themis/workspace-restore/workspace-restore-types";

export type AppStoreCore = ReactStore<
  {
    annotations: AnnotationsState;
    bookmarks: BookmarksState;
    books: BooksState;
    readingPositions: ReadingPositionsState;
    workspaceRestore: WorkspaceRestoreState;
  },
  {
    annotations: typeof annotationsReducer;
    bookmarks: typeof bookmarksReducer;
    books: typeof booksReducer;
    readingPositions: typeof readingPositionsReducer;
    workspaceRestore: typeof workspaceRestoreReducer;
  }
>;

export function createAppStore() {
  const store = new ReactStore({
    annotations: annotationsReducer,
    bookmarks: bookmarksReducer,
    books: booksReducer,
    readingPositions: readingPositionsReducer,
    workspaceRestore: workspaceRestoreReducer,
  });
  return Object.assign(store, {
    annotationsSelectors: createAnnotationsSelectors(store),
    bookmarksSelectors: createBookmarksSelectors(store),
    booksSelectors: createBooksSelectors(store),
    readingPositionsSelectors: createReadingPositionsSelectors(store),
    workspaceRestoreSelectors: createWorkspaceRestoreSelectors(store),
  });
}

export type AppStore = ReturnType<typeof createAppStore>;
