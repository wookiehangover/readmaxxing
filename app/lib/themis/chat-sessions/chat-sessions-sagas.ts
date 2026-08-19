import { call, put, takeEvery } from "typed-redux-saga";

import { ChatService, type ChatMessage, type ChatSession } from "~/lib/stores/chat-store";
import {
  cacheChatMessagesRequested,
  chatMessagesCached,
  chatSessionCreated,
  chatSessionDeleted,
  chatSessionSelected,
  chatSessionUpdated,
  chatSessionsFailed,
  chatSessionsHydrated,
  createChatSessionRequested,
  deleteChatSessionRequested,
  generateChatSessionTitleRequested,
  hydrateChatSessionsRequested,
  selectChatSessionRequested,
} from "~/lib/themis/chat-sessions/chat-sessions-slice";
import type {
  ChatSessionCompletedCallback,
  ChatSessionDeletedCallback,
  ChatSessionFailedCallback,
  ChatSessionsHydratedCallback,
} from "~/lib/themis/chat-sessions/chat-sessions-types";

async function loadChatSessions(bookId: string, createIfMissing: boolean) {
  let sessions = await ChatService.getSessionsByBook(bookId);
  let activeSessionId = await ChatService.getActiveSessionId(bookId);
  if (activeSessionId && !sessions.some((session) => session.id === activeSessionId)) {
    activeSessionId = null;
  }
  if (!activeSessionId && sessions.length > 0) {
    activeSessionId = sessions[sessions.length - 1].id;
    await ChatService.setActiveSessionId(bookId, activeSessionId);
  } else if (!activeSessionId && createIfMissing) {
    const session = await ChatService.createSession(bookId);
    sessions = [...sessions, session];
    activeSessionId = session.id;
  }
  return { sessions, activeSessionId };
}

async function persistSessionCreation(bookId: string, title?: string) {
  return ChatService.createSession(bookId, title);
}

async function persistSessionSelection(bookId: string, sessionId: string) {
  const session = await ChatService.getSession(sessionId, bookId);
  if (!session) throw new Error(`Chat session ${sessionId} was not found`);
  await ChatService.setActiveSessionId(bookId, sessionId);
  return session;
}

async function persistSessionDeletion(bookId: string, sessionId: string) {
  await ChatService.deleteSession(sessionId, bookId);
  return ChatService.getActiveSessionId(bookId);
}

async function persistSessionTitle(bookId: string, sessionId: string, title: string) {
  await ChatService.updateSessionTitle(sessionId, bookId, title);
  const session = await ChatService.getSession(sessionId, bookId);
  if (!session) throw new Error(`Chat session ${sessionId} was not found`);
  return session;
}

async function generateSessionTitle(
  messages: Parameters<typeof generateChatSessionTitleRequested>[2],
) {
  const response = await fetch("/api/chat-title", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!response.ok) return null;
  const { title } = (await response.json()) as { title?: string };
  return title || null;
}

async function persistMessageCache(bookId: string, sessionId: string, messages: ChatMessage[]) {
  await ChatService.cacheServerMessages(bookId, sessionId, messages);
  return messages;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function notifySession(callback: ChatSessionCompletedCallback | undefined, session: ChatSession) {
  return callback?.(session);
}

function notifyDeleted(callback: ChatSessionDeletedCallback | undefined, sessionId: string | null) {
  return callback?.(sessionId);
}

function notifyHydrated(
  callback: ChatSessionsHydratedCallback | undefined,
  session: ChatSession | null,
) {
  return callback?.(session);
}

function notifyFailed(callback: ChatSessionFailedCallback | undefined, error: string) {
  callback?.(error);
}

export function* hydrateChatSessionsSaga(action: ReturnType<typeof hydrateChatSessionsRequested>) {
  const [bookId, createIfMissing = false, onCompleted, onFailed] = action.payload;
  try {
    const { sessions, activeSessionId } = yield* call(loadChatSessions, bookId, createIfMissing);
    yield* put(chatSessionsHydrated(bookId, sessions, activeSessionId));
    yield* call(
      notifyHydrated,
      onCompleted,
      sessions.find((session) => session.id === activeSessionId) ?? null,
    );
  } catch (error) {
    const message = errorMessage(error);
    yield* put(chatSessionsFailed(bookId, message));
    yield* call(notifyFailed, onFailed, message);
  }
}

export function* createChatSessionSaga(action: ReturnType<typeof createChatSessionRequested>) {
  const [bookId, title, onCompleted, onFailed] = action.payload;
  try {
    const session = yield* call(persistSessionCreation, bookId, title);
    yield* put(chatSessionCreated(session));
    yield* call(notifySession, onCompleted, session);
  } catch (error) {
    const message = errorMessage(error);
    yield* put(chatSessionsFailed(bookId, message));
    yield* call(notifyFailed, onFailed, message);
  }
}

export function* selectChatSessionSaga(action: ReturnType<typeof selectChatSessionRequested>) {
  const [bookId, sessionId, onCompleted, onFailed] = action.payload;
  try {
    const session = yield* call(persistSessionSelection, bookId, sessionId);
    yield* put(chatSessionSelected(bookId, sessionId));
    yield* call(notifySession, onCompleted, session);
  } catch (error) {
    const message = errorMessage(error);
    yield* put(chatSessionsFailed(bookId, message));
    yield* call(notifyFailed, onFailed, message);
  }
}

export function* deleteChatSessionSaga(action: ReturnType<typeof deleteChatSessionRequested>) {
  const [bookId, sessionId, onCompleted, onFailed] = action.payload;
  try {
    const nextActiveSessionId = yield* call(persistSessionDeletion, bookId, sessionId);
    yield* put(chatSessionDeleted(bookId, sessionId, nextActiveSessionId));
    yield* call(notifyDeleted, onCompleted, nextActiveSessionId);
  } catch (error) {
    const message = errorMessage(error);
    yield* put(chatSessionsFailed(bookId, message));
    yield* call(notifyFailed, onFailed, message);
  }
}

export function* generateChatSessionTitleSaga(
  action: ReturnType<typeof generateChatSessionTitleRequested>,
) {
  const [bookId, sessionId, messages] = action.payload;
  try {
    const title = yield* call(generateSessionTitle, messages);
    if (!title) return;
    const session = yield* call(persistSessionTitle, bookId, sessionId, title);
    yield* put(chatSessionUpdated(session));
  } catch (error) {
    yield* put(chatSessionsFailed(bookId, errorMessage(error)));
  }
}

export function* cacheChatMessagesSaga(action: ReturnType<typeof cacheChatMessagesRequested>) {
  const [bookId, sessionId, messages] = action.payload;
  try {
    const persisted = yield* call(persistMessageCache, bookId, sessionId, messages);
    yield* put(chatMessagesCached(sessionId, persisted));
  } catch (error) {
    yield* put(chatSessionsFailed(bookId, errorMessage(error)));
  }
}

export function* chatSessionsSaga() {
  yield* takeEvery(hydrateChatSessionsRequested, hydrateChatSessionsSaga);
  yield* takeEvery(createChatSessionRequested, createChatSessionSaga);
  yield* takeEvery(selectChatSessionRequested, selectChatSessionSaga);
  yield* takeEvery(deleteChatSessionRequested, deleteChatSessionSaga);
  yield* takeEvery(generateChatSessionTitleRequested, generateChatSessionTitleSaga);
  yield* takeEvery(cacheChatMessagesRequested, cacheChatMessagesSaga);
}
