import { filterItems, getItem } from "@augmentcode/themis/utils/collections/collection-utils";

import type { ChatSession } from "~/lib/stores/chat-store";
import type { AppStoreCore } from "~/lib/themis/store";

export function createChatSessionsSelectors(store: AppStoreCore) {
  const selectSessionsByBook = store.createSelector((state, bookId: string) =>
    filterItems(
      state.chatSessions.collection,
      (session): session is ChatSession => session.bookId === bookId,
    ),
  );
  const selectActiveSessionId = store.createSelector(
    (state, bookId: string) => state.chatSessions.activeSessionIdsByBook[bookId] ?? null,
  );

  return {
    selectSessionsByBook,
    selectRecentSessionsByBook: store.createSelector((state, bookId: string) =>
      [...selectSessionsByBook.select(state, bookId)].sort((a, b) => b.updatedAt - a.updatedAt),
    ),
    selectActiveSessionId,
    selectActiveSessionByBook: store.createSelector((state, bookId: string) => {
      const sessionId = selectActiveSessionId.select(state, bookId);
      return sessionId ? getItem(state.chatSessions.collection, sessionId) : undefined;
    }),
    selectChatSessionsLoaded: store.createSelector((state, bookId: string) =>
      state.chatSessions.loadedBookIds.includes(bookId),
    ),
    selectChatSessionsError: store.createSelector(
      (state, bookId: string) => state.chatSessions.errorsByBookId[bookId] ?? null,
    ),
  };
}
