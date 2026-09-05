import { get, set, del } from "idb-keyval";
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

async function chatOperation<T>(operation: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (cause) {
    throw new ChatError({ operation, cause });
  }
}

export const ChatService = {
  // --- Warm-start read path ---

  getMessages: (bookId: string) =>
    chatOperation("getMessages", async () => {
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
    }),

  // --- Session CRUD ---

  createSession: (bookId: string, title?: string) =>
    chatOperation("createSession", async () => {
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
    }),

  getSession: (sessionId: string, bookId: string) =>
    chatOperation("getSession", async () => {
      const sessions = await get<ChatSession[]>(bookId, getSessionStore());
      return sessions?.find((s) => s.id === sessionId) ?? null;
    }),

  getSessionsByBook: (bookId: string) =>
    chatOperation("getSessionsByBook", async () => {
      let sessions = await get<ChatSession[]>(bookId, getSessionStore());
      if (!sessions || sessions.length === 0) {
        sessions = await migrateOldMessages(bookId);
      }
      return sessions ?? [];
    }),

  cacheServerMessages: (bookId: string, sessionId: string, messages: ChatMessage[]) =>
    chatOperation("cacheServerMessages", async () => {
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
    }),

  deleteSession: (sessionId: string, bookId: string) =>
    chatOperation("deleteSession", async () => {
      const sessions = (await get<ChatSession[]>(bookId, getSessionStore())) ?? [];
      const deleted = sessions.find((s) => s.id === sessionId);
      const filtered = sessions.filter((s) => s.id !== sessionId);
      await set(bookId, filtered, getSessionStore());

      if (deleted) {
        trackSessionChange(
          { ...deleted, updatedAt: Math.max(Date.now(), deleted.updatedAt + 1) },
          "delete",
        );
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
    }),

  // --- Active session tracking ---

  getActiveSessionId: (bookId: string) =>
    chatOperation("getActiveSessionId", async () => {
      return (await get<string>(bookId, getActiveSessionStore())) ?? null;
    }),

  setActiveSessionId: (bookId: string, sessionId: string) =>
    chatOperation("setActiveSessionId", () => set(bookId, sessionId, getActiveSessionStore())),

  updateSessionTitle: (sessionId: string, bookId: string, title: string) =>
    chatOperation("updateSessionTitle", async () => {
      const sessions = (await get<ChatSession[]>(bookId, getSessionStore())) ?? [];
      const idx = sessions.findIndex((s) => s.id === sessionId);
      if (idx >= 0) {
        sessions[idx] = {
          ...sessions[idx],
          title,
          updatedAt: Math.max(Date.now(), sessions[idx].updatedAt + 1),
        };
        await set(bookId, sessions, getSessionStore());
        trackSessionChange(sessions[idx]);
      }
    }),
};
