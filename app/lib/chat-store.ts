import { createStore, get, set, del } from "idb-keyval";
import { Context, Effect, Layer } from "effect";
import { ChatError } from "~/lib/errors";

// --- Types ---

/** Serializable representation of a UIMessage part for IndexedDB persistence. */
export type SerializedPart =
  | { type: "text"; text: string }
  | { type: "step-start" }
  | {
      type: string;
      toolCallId?: string;
      state?: string;
      toolName?: string;
      input?: Record<string, unknown>;
      output?: unknown;
    };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  /** Full parts array from AI SDK UIMessage, preserved for tool call display on reload. */
  parts?: SerializedPart[];
}

export interface ChatSession {
  id: string;
  bookId: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

// --- idb-keyval stores (lazy-initialized for SSR safety) ---

/** Original messages store — kept for backward-compat migration reads. */
let _chatStore: ReturnType<typeof createStore> | null = null;
function getChatStore() {
  if (!_chatStore) _chatStore = createStore("ebook-reader-chats", "chats");
  return _chatStore;
}

/** Session metadata store: key = bookId, value = ChatSession[] */
let _sessionStore: ReturnType<typeof createStore> | null = null;
function getSessionStore() {
  if (!_sessionStore) _sessionStore = createStore("ebook-reader-chat-sessions", "sessions");
  return _sessionStore;
}

/** Active session ID store: key = bookId, value = sessionId string */
let _activeSessionStore: ReturnType<typeof createStore> | null = null;
function getActiveSessionStore() {
  if (!_activeSessionStore)
    _activeSessionStore = createStore("ebook-reader-active-session", "active-session");
  return _activeSessionStore;
}

// --- Helpers ---

function generateSessionId(): string {
  return crypto.randomUUID();
}

// --- Service interface ---

export class ChatService extends Context.Tag("ChatService")<
  ChatService,
  {
    // Legacy methods (delegate to active session)
    readonly getMessages: (bookId: string) => Effect.Effect<ChatMessage[], ChatError>;
    readonly saveMessages: (
      bookId: string,
      messages: ChatMessage[],
    ) => Effect.Effect<void, ChatError>;
    readonly clearMessages: (bookId: string) => Effect.Effect<void, ChatError>;

    // Session CRUD
    readonly createSession: (
      bookId: string,
      title?: string,
    ) => Effect.Effect<ChatSession, ChatError>;
    readonly getSession: (
      sessionId: string,
      bookId: string,
    ) => Effect.Effect<ChatSession | null, ChatError>;
    readonly getSessionsByBook: (bookId: string) => Effect.Effect<ChatSession[], ChatError>;
    readonly saveSession: (session: ChatSession) => Effect.Effect<void, ChatError>;
    readonly deleteSession: (sessionId: string, bookId: string) => Effect.Effect<void, ChatError>;

    // Active session tracking per book
    readonly getActiveSessionId: (bookId: string) => Effect.Effect<string | null, ChatError>;
    readonly setActiveSessionId: (
      bookId: string,
      sessionId: string,
    ) => Effect.Effect<void, ChatError>;

    // Surgical field updates (avoids race conditions with concurrent saveSession calls)
    readonly updateSessionTitle: (
      sessionId: string,
      bookId: string,
      title: string,
    ) => Effect.Effect<void, ChatError>;
  }
>() {}

// --- Migration helper ---

/**
 * When getSessionsByBook finds no sessions but old-format messages exist
 * for the bookId, automatically create a "default" session from them.
 */
async function migrateOldMessages(bookId: string): Promise<ChatSession[]> {
  const oldMessages = await get<ChatMessage[]>(bookId, getChatStore());
  if (!oldMessages || oldMessages.length === 0) return [];

  const now = Date.now();
  const earliest = oldMessages.reduce(
    (min, m) => (m.createdAt < min ? m.createdAt : min),
    oldMessages[0].createdAt,
  );

  const session: ChatSession = {
    id: generateSessionId(),
    bookId,
    title: "",
    messages: oldMessages,
    createdAt: earliest,
    updatedAt: now,
  };

  // Persist the migrated session
  await set(bookId, [session], getSessionStore());
  // Set as active
  await set(bookId, session.id, getActiveSessionStore());

  return [session];
}

// --- Live implementation ---

export const ChatServiceLive = Layer.succeed(ChatService, {
  // --- Legacy methods (delegate to active session) ---

  getMessages: (bookId) =>
    Effect.tryPromise({
      try: async () => {
        let sessions = await get<ChatSession[]>(bookId, getSessionStore());
        if (!sessions || sessions.length === 0) {
          sessions = await migrateOldMessages(bookId);
        }
        if (!sessions || sessions.length === 0) return [];

        const activeId = await get<string>(bookId, getActiveSessionStore());
        const active = activeId
          ? sessions.find((s) => s.id === activeId)
          : sessions[sessions.length - 1];
        return active?.messages ?? [];
      },
      catch: (cause) => new ChatError({ operation: "getMessages", cause }),
    }),

  saveMessages: (bookId, messages) =>
    Effect.tryPromise({
      try: async () => {
        let sessions = await get<ChatSession[]>(bookId, getSessionStore());
        if (!sessions || sessions.length === 0) {
          sessions = await migrateOldMessages(bookId);
        }

        const activeId = await get<string>(bookId, getActiveSessionStore());
        const now = Date.now();

        if (!sessions || sessions.length === 0) {
          // No sessions at all — create one
          const session: ChatSession = {
            id: generateSessionId(),
            bookId,
            title: "",
            messages,
            createdAt: now,
            updatedAt: now,
          };
          await set(bookId, [session], getSessionStore());
          await set(bookId, session.id, getActiveSessionStore());
          return;
        }

        const idx = activeId ? sessions.findIndex((s) => s.id === activeId) : sessions.length - 1;
        if (idx >= 0) {
          sessions[idx] = { ...sessions[idx], messages, updatedAt: now };
          await set(bookId, sessions, getSessionStore());
        }
      },
      catch: (cause) => new ChatError({ operation: "saveMessages", cause }),
    }),

  clearMessages: (bookId) =>
    Effect.tryPromise({
      try: async () => {
        const sessions = await get<ChatSession[]>(bookId, getSessionStore());
        const activeId = await get<string>(bookId, getActiveSessionStore());

        if (sessions && activeId) {
          const idx = sessions.findIndex((s) => s.id === activeId);
          if (idx >= 0) {
            sessions[idx] = { ...sessions[idx], messages: [], updatedAt: Date.now() };
            await set(bookId, sessions, getSessionStore());
          }
        }
      },
      catch: (cause) => new ChatError({ operation: "clearMessages", cause }),
    }),

  // --- Session CRUD ---

  createSession: (bookId, title) =>
    Effect.tryPromise({
      try: async () => {
        const now = Date.now();
        const session: ChatSession = {
          id: generateSessionId(),
          bookId,
          title: title ?? "",
          messages: [],
          createdAt: now,
          updatedAt: now,
        };
        const sessions = (await get<ChatSession[]>(bookId, getSessionStore())) ?? [];
        sessions.push(session);
        await set(bookId, sessions, getSessionStore());
        await set(bookId, session.id, getActiveSessionStore());
        return session;
      },
      catch: (cause) => new ChatError({ operation: "createSession", cause }),
    }),

  getSession: (sessionId, bookId) =>
    Effect.tryPromise({
      try: async () => {
        const sessions = await get<ChatSession[]>(bookId, getSessionStore());
        return sessions?.find((s) => s.id === sessionId) ?? null;
      },
      catch: (cause) => new ChatError({ operation: "getSession", cause }),
    }),

  getSessionsByBook: (bookId) =>
    Effect.tryPromise({
      try: async () => {
        let sessions = await get<ChatSession[]>(bookId, getSessionStore());
        if (!sessions || sessions.length === 0) {
          sessions = await migrateOldMessages(bookId);
        }
        return sessions ?? [];
      },
      catch: (cause) => new ChatError({ operation: "getSessionsByBook", cause }),
    }),

  saveSession: (session) =>
    Effect.tryPromise({
      try: async () => {
        const sessions = (await get<ChatSession[]>(session.bookId, getSessionStore())) ?? [];
        const idx = sessions.findIndex((s) => s.id === session.id);
        if (idx >= 0) {
          sessions[idx] = { ...session, updatedAt: Date.now() };
        } else {
          sessions.push({ ...session, updatedAt: Date.now() });
        }
        await set(session.bookId, sessions, getSessionStore());
      },
      catch: (cause) => new ChatError({ operation: "saveSession", cause }),
    }),

  deleteSession: (sessionId, bookId) =>
    Effect.tryPromise({
      try: async () => {
        const sessions = (await get<ChatSession[]>(bookId, getSessionStore())) ?? [];
        const filtered = sessions.filter((s) => s.id !== sessionId);
        await set(bookId, filtered, getSessionStore());

        // If the deleted session was active, clear or reset active
        const activeId = await get<string>(bookId, getActiveSessionStore());
        if (activeId === sessionId) {
          if (filtered.length > 0) {
            await set(bookId, filtered[filtered.length - 1].id, getActiveSessionStore());
          } else {
            await del(bookId, getActiveSessionStore());
          }
        }
      },
      catch: (cause) => new ChatError({ operation: "deleteSession", cause }),
    }),

  // --- Active session tracking ---

  getActiveSessionId: (bookId) =>
    Effect.tryPromise({
      try: async () => {
        return (await get<string>(bookId, getActiveSessionStore())) ?? null;
      },
      catch: (cause) => new ChatError({ operation: "getActiveSessionId", cause }),
    }),

  setActiveSessionId: (bookId, sessionId) =>
    Effect.tryPromise({
      try: () => set(bookId, sessionId, getActiveSessionStore()),
      catch: (cause) => new ChatError({ operation: "setActiveSessionId", cause }),
    }),

  updateSessionTitle: (sessionId, bookId, title) =>
    Effect.tryPromise({
      try: async () => {
        const sessions = (await get<ChatSession[]>(bookId, getSessionStore())) ?? [];
        const idx = sessions.findIndex((s) => s.id === sessionId);
        if (idx >= 0) {
          sessions[idx] = { ...sessions[idx], title, updatedAt: Date.now() };
          await set(bookId, sessions, getSessionStore());
        }
      },
      catch: (cause) => new ChatError({ operation: "updateSessionTitle", cause }),
    }),
});
