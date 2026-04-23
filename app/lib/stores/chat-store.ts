import { get, set, del } from "idb-keyval";
import { Context, Effect, Layer } from "effect";
import { ChatError } from "~/lib/errors";
import { recordChange } from "~/lib/sync/change-log";
import {
  getActiveSessionStore,
  getChatMessagesStore,
  getChatSessionStore,
} from "~/lib/sync/stores";

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

// --- idb-keyval stores imported from ~/lib/sync/stores ---
//
// Legacy migration reads go through `getChatMessagesStore()`
// (ebook-reader-chats/chats). Session metadata uses `getChatSessionStore()`
// and active-session pointers use `getActiveSessionStore()`.

// Local alias used internally; the central module exposes `getChatMessagesStore`.
const getChatStore = getChatMessagesStore;
const getSessionStore = getChatSessionStore;

// --- Helpers ---

function generateSessionId(): string {
  return crypto.randomUUID();
}

/** Fire-and-forget: record a session change in the sync change log. */
function trackSessionChange(session: ChatSession, operation: "put" | "delete" = "put"): void {
  const { messages: _msgs, ...metadata } = session;
  recordChange({
    entity: "chat_session",
    entityId: session.id,
    operation,
    data: metadata,
    timestamp: session.updatedAt,
  }).catch(console.error);
}

/**
 * Tombstone-merge path used by the sync pull merger. Removes a session (and
 * its cached messages, which live inside the per-bookId session array value)
 * from IDB, and clears the active-session pointer if it still points at the
 * removed session.
 *
 * Does NOT enqueue a sync change: the caller is reconciling a server-side
 * tombstone that the server already knows about. Enqueuing a delete here
 * would echo the same tombstone back on the next push.
 */
export async function removeSessionLocally(bookId: string, sessionId: string): Promise<void> {
  const sessions = (await get<ChatSession[]>(bookId, getSessionStore())) ?? [];
  const filtered = sessions.filter((s) => s.id !== sessionId);
  if (filtered.length === sessions.length) return;

  await set(bookId, filtered, getSessionStore());

  const activeId = await get<string>(bookId, getActiveSessionStore());
  if (activeId === sessionId) {
    if (filtered.length > 0) {
      await set(bookId, filtered[filtered.length - 1].id, getActiveSessionStore());
    } else {
      await del(bookId, getActiveSessionStore());
    }
  }
}

// --- Service interface ---

export class ChatService extends Context.Tag("ChatService")<
  ChatService,
  {
    // Warm-start read path (delegates to the active session)
    readonly getMessages: (bookId: string) => Effect.Effect<ChatMessage[], ChatError>;

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
    readonly deleteSession: (sessionId: string, bookId: string) => Effect.Effect<void, ChatError>;

    // Active session tracking per book
    readonly getActiveSessionId: (bookId: string) => Effect.Effect<string | null, ChatError>;
    readonly setActiveSessionId: (
      bookId: string,
      sessionId: string,
    ) => Effect.Effect<void, ChatError>;

    // Title edits (LWW via recordChange)
    readonly updateSessionTitle: (
      sessionId: string,
      bookId: string,
      title: string,
    ) => Effect.Effect<void, ChatError>;

    // Server-reconciliation cache write. Replaces the active session's
    // messages in IDB with the authoritative server list. Does NOT enqueue
    // sync changes — the server is already the source of truth for chat.
    readonly cacheServerMessages: (
      bookId: string,
      sessionId: string,
      messages: ChatMessage[],
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
  // Enqueue a sync change so the migrated session is pushed to the server on
  // its own, without waiting for runInitialSyncIfNeeded to scan everything.
  trackSessionChange(session);

  return [session];
}

// --- Live implementation ---

export const ChatServiceLive = Layer.succeed(ChatService, {
  // --- Warm-start read path ---

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
        trackSessionChange(session);
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

  cacheServerMessages: (bookId, sessionId, messages) =>
    Effect.tryPromise({
      try: async () => {
        const sessions = (await get<ChatSession[]>(bookId, getSessionStore())) ?? [];
        const idx = sessions.findIndex((s) => s.id === sessionId);
        if (idx < 0) return;
        // Server is authoritative for chat messages, so this is a warm-start
        // cache update only. Do NOT bump updatedAt — it is the LWW clock for
        // session metadata (title, bookId), and bumping it on every message
        // hydration would silently overwrite legitimate metadata edits from
        // other devices on the next sync pull.
        sessions[idx] = { ...sessions[idx], messages };
        await set(bookId, sessions, getSessionStore());
      },
      catch: (cause) => new ChatError({ operation: "cacheServerMessages", cause }),
    }),

  deleteSession: (sessionId, bookId) =>
    Effect.tryPromise({
      try: async () => {
        const sessions = (await get<ChatSession[]>(bookId, getSessionStore())) ?? [];
        const deleted = sessions.find((s) => s.id === sessionId);
        const filtered = sessions.filter((s) => s.id !== sessionId);
        await set(bookId, filtered, getSessionStore());

        if (deleted) {
          trackSessionChange({ ...deleted, updatedAt: Date.now() }, "delete");
        }

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
          trackSessionChange(sessions[idx]);
        }
      },
      catch: (cause) => new ChatError({ operation: "updateSessionTitle", cause }),
    }),
});
