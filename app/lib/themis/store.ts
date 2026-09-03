import { createReadingRailSelectors } from "~/lib/themis/reading-rail/reading-rail-selectors";
import { readingRailReducer } from "~/lib/themis/reading-rail/reading-rail-slice";
import type { ReadingRailState } from "~/lib/themis/reading-rail/reading-rail-types";
import { ReactStore } from "@augmentcode/themis/react-store";

import { createAnnotationsSelectors } from "~/lib/themis/annotations/annotations-selectors";
import { annotationsReducer } from "~/lib/themis/annotations/annotations-slice";
import type { AnnotationsState } from "~/lib/themis/annotations/annotations-types";
import { createAuthSessionSelectors } from "~/lib/themis/auth-session/auth-session-selectors";
import { authSessionReducer } from "~/lib/themis/auth-session/auth-session-slice";
import type { AuthSessionState } from "~/lib/themis/auth-session/auth-session-types";
import { createBookmarksSelectors } from "~/lib/themis/bookmarks/bookmarks-selectors";
import { bookmarksReducer } from "~/lib/themis/bookmarks/bookmarks-slice";
import type { BookmarksState } from "~/lib/themis/bookmarks/bookmarks-types";
import type { BooksState } from "~/lib/themis/books/books-slice";
import { createBooksSelectors } from "~/lib/themis/books/books-selectors";
import { booksReducer } from "~/lib/themis/books/books-slice";
import { createChatSessionsSelectors } from "~/lib/themis/chat-sessions/chat-sessions-selectors";
import { chatSessionsReducer } from "~/lib/themis/chat-sessions/chat-sessions-slice";
import type { ChatSessionsState } from "~/lib/themis/chat-sessions/chat-sessions-types";
import { createReadingPositionsSelectors } from "~/lib/themis/reading-positions/reading-positions-selectors";
import { readingPositionsReducer } from "~/lib/themis/reading-positions/reading-positions-slice";
import type { ReadingPositionsState } from "~/lib/themis/reading-positions/reading-positions-types";
import { createReviewsSelectors } from "~/lib/themis/reviews/reviews-selectors";
import { reviewsReducer } from "~/lib/themis/reviews/reviews-slice";
import type { ReviewsState } from "~/lib/themis/reviews/reviews-types";
import { createWorkspaceRestoreSelectors } from "~/lib/themis/workspace-restore/workspace-restore-selectors";
import { workspaceRestoreReducer } from "~/lib/themis/workspace-restore/workspace-restore-slice";
import type { WorkspaceRestoreState } from "~/lib/themis/workspace-restore/workspace-restore-types";

export type AppStoreCore = ReactStore<
  {
    annotations: AnnotationsState;
    authSession: AuthSessionState;
    bookmarks: BookmarksState;
    books: BooksState;
    chatSessions: ChatSessionsState;
    readingPositions: ReadingPositionsState;
    reviews: ReviewsState;
    readingRail: ReadingRailState;
    workspaceRestore: WorkspaceRestoreState;
  },
  {
    annotations: typeof annotationsReducer;
    authSession: typeof authSessionReducer;
    bookmarks: typeof bookmarksReducer;
    books: typeof booksReducer;
    chatSessions: typeof chatSessionsReducer;
    readingPositions: typeof readingPositionsReducer;
    reviews: typeof reviewsReducer;
    readingRail: typeof readingRailReducer;
    workspaceRestore: typeof workspaceRestoreReducer;
  }
>;

export function createAppStore() {
  const store = new ReactStore({
    annotations: annotationsReducer,
    authSession: authSessionReducer,
    bookmarks: bookmarksReducer,
    books: booksReducer,
    chatSessions: chatSessionsReducer,
    readingPositions: readingPositionsReducer,
    reviews: reviewsReducer,
    readingRail: readingRailReducer,
    workspaceRestore: workspaceRestoreReducer,
  });
  const reviewsSelectors = createReviewsSelectors(store);
  return Object.assign(store, {
    readingRailSelectors: createReadingRailSelectors(store, reviewsSelectors),
    annotationsSelectors: createAnnotationsSelectors(store),
    authSessionSelectors: createAuthSessionSelectors(store),
    bookmarksSelectors: createBookmarksSelectors(store),
    booksSelectors: createBooksSelectors(store),
    chatSessionsSelectors: createChatSessionsSelectors(store),
    readingPositionsSelectors: createReadingPositionsSelectors(store),
    reviewsSelectors,
    workspaceRestoreSelectors: createWorkspaceRestoreSelectors(store),
  });
}

export type AppStore = ReturnType<typeof createAppStore>;
