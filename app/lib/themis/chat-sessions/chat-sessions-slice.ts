import {
  addItems,
  createCollection,
  filterCollection,
  getItem,
  removeItem,
  upsertItem,
} from "@augmentcode/themis/utils/collections/collection-utils";
import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
import type { UIMessage } from "@ai-sdk/react";

import type { ChatMessage, ChatSession } from "~/lib/stores/chat-store";
import type {
  ChatSessionCompletedCallback,
  ChatSessionDeletedCallback,
  ChatSessionFailedCallback,
  ChatSessionsHydratedCallback,
  ChatSessionsState,
} from "~/lib/themis/chat-sessions/chat-sessions-types";

export const hydrateChatSessionsRequested = createAction<
  [
    bookId: string,
    createIfMissing?: boolean,
    onCompleted?: ChatSessionsHydratedCallback,
    onFailed?: ChatSessionFailedCallback,
  ]
>("chatSessions/hydrateRequested");
export const chatSessionsHydrated =
  createAction<[bookId: string, sessions: ChatSession[], activeSessionId: string | null]>(
    "chatSessions/hydrated",
  );
export const createChatSessionRequested = createAction<
  [
    bookId: string,
    title?: string,
    onCompleted?: ChatSessionCompletedCallback,
    onFailed?: ChatSessionFailedCallback,
  ]
>("chatSessions/createRequested");
export const chatSessionCreated = createAction<[session: ChatSession]>("chatSessions/created");
export const selectChatSessionRequested = createAction<
  [
    bookId: string,
    sessionId: string,
    onCompleted?: ChatSessionCompletedCallback,
    onFailed?: ChatSessionFailedCallback,
  ]
>("chatSessions/selectRequested");
export const chatSessionSelected =
  createAction<[bookId: string, sessionId: string]>("chatSessions/selected");
export const deleteChatSessionRequested = createAction<
  [
    bookId: string,
    sessionId: string,
    onCompleted?: ChatSessionDeletedCallback,
    onFailed?: ChatSessionFailedCallback,
  ]
>("chatSessions/deleteRequested");
export const chatSessionDeleted =
  createAction<[bookId: string, sessionId: string, nextActiveSessionId: string | null]>(
    "chatSessions/deleted",
  );
export const generateChatSessionTitleRequested = createAction<
  [bookId: string, sessionId: string, messages: UIMessage[]]
>("chatSessions/generateTitleRequested");
export const chatSessionUpdated = createAction<[session: ChatSession]>("chatSessions/updated");
export const cacheChatMessagesRequested = createAction<
  [bookId: string, sessionId: string, messages: ChatMessage[]]
>("chatSessions/cacheMessagesRequested");
export const chatMessagesCached = createAction<[sessionId: string, messages: ChatMessage[]]>(
  "chatSessions/messagesCached",
);
export const chatSessionsFailed =
  createAction<[bookId: string, error: string]>("chatSessions/failed");

export const chatSessionsInitialState: ChatSessionsState = {
  collection: createCollection<ChatSession, "id">("id"),
  activeSessionIdsByBook: {},
  loadingBookIds: [],
  loadedBookIds: [],
  errorsByBookId: {},
};

const reducer = createReducer<ChatSessionsState>(chatSessionsInitialState);

reducer.with(hydrateChatSessionsRequested, (state, { payload: [bookId] }) => {
  const { [bookId]: _, ...errorsByBookId } = state.errorsByBookId;
  return {
    ...state,
    loadingBookIds: state.loadingBookIds.includes(bookId)
      ? state.loadingBookIds
      : [...state.loadingBookIds, bookId],
    errorsByBookId,
  };
});
reducer.with(chatSessionsHydrated, (state, { payload: [bookId, sessions, activeSessionId] }) => {
  const otherSessions = filterCollection(
    state.collection,
    (session): session is ChatSession => session.bookId !== bookId,
  );
  const { [bookId]: _error, ...errorsByBookId } = state.errorsByBookId;
  const { [bookId]: _active, ...otherActiveSessionIds } = state.activeSessionIdsByBook;
  return {
    ...state,
    collection: addItems(otherSessions, sessions),
    activeSessionIdsByBook: activeSessionId
      ? { ...otherActiveSessionIds, [bookId]: activeSessionId }
      : otherActiveSessionIds,
    loadingBookIds: state.loadingBookIds.filter((id) => id !== bookId),
    loadedBookIds: state.loadedBookIds.includes(bookId)
      ? state.loadedBookIds
      : [...state.loadedBookIds, bookId],
    errorsByBookId,
  };
});
reducer.with(chatSessionCreated, (state, { payload: [session] }) => ({
  ...state,
  collection: upsertItem(state.collection, session),
  activeSessionIdsByBook: {
    ...state.activeSessionIdsByBook,
    [session.bookId]: session.id,
  },
}));
reducer.with(chatSessionSelected, (state, { payload: [bookId, sessionId] }) =>
  state.activeSessionIdsByBook[bookId] === sessionId
    ? state
    : {
        ...state,
        activeSessionIdsByBook: { ...state.activeSessionIdsByBook, [bookId]: sessionId },
      },
);
reducer.with(chatSessionDeleted, (state, { payload: [bookId, sessionId, nextActiveId] }) => {
  const { [bookId]: _active, ...otherActiveSessionIds } = state.activeSessionIdsByBook;
  return {
    ...state,
    collection: removeItem(state.collection, sessionId),
    activeSessionIdsByBook: nextActiveId
      ? { ...otherActiveSessionIds, [bookId]: nextActiveId }
      : otherActiveSessionIds,
  };
});
reducer.with(chatSessionUpdated, (state, { payload: [session] }) => ({
  ...state,
  collection: upsertItem(state.collection, session),
}));
reducer.with(chatMessagesCached, (state, { payload: [sessionId, messages] }) => {
  const session = getItem(state.collection, sessionId);
  if (!session || session.messages === messages) return state;
  return {
    ...state,
    collection: upsertItem(state.collection, { ...session, messages }),
  };
});
reducer.with(chatSessionsFailed, (state, { payload: [bookId, error] }) => ({
  ...state,
  loadingBookIds: state.loadingBookIds.filter((id) => id !== bookId),
  loadedBookIds: state.loadedBookIds.includes(bookId)
    ? state.loadedBookIds
    : [...state.loadedBookIds, bookId],
  errorsByBookId: { ...state.errorsByBookId, [bookId]: error },
}));

export const chatSessionsReducer = reducer;
