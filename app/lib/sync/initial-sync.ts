import { createStore, get, set, entries } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import { recordChange } from "./change-log";
import type { ChatSession } from "~/lib/stores/chat-store";

const INITIAL_SYNC_KEY = "initial-sync-complete";

// Lazy store for the flag (separate DB to avoid conflicts)
let _flagStore: ReturnType<typeof createStore> | null = null;
function getFlagStore(): UseStore {
  if (!_flagStore) _flagStore = createStore("ebook-reader-sync-flags", "flags");
  return _flagStore;
}

/**
 * One-time scan of all IDB stores to create change-log entries for
 * existing data. This ensures users who had data before the sync
 * feature was added get their data pushed to the server on first sync.
 */
export async function runInitialSyncIfNeeded(): Promise<void> {
  const done = await get(INITIAL_SYNC_KEY, getFlagStore());
  if (done) return;

  console.log("[sync] Running initial sync push for existing data...");

  // 1. Books (key = bookId, value = BookMeta)
  const bookStore = createStore("ebook-reader-db", "books");
  const books = await entries(bookStore);
  for (const [id, data] of books) {
    await recordChange({
      entity: "book",
      entityId: id as string,
      operation: "put",
      data,
      timestamp: ((data as Record<string, unknown>)?.updatedAt as number) ?? Date.now(),
    });
  }

  // 2. Reading positions (key = bookId, value = PositionRecord)
  const posStore = createStore("ebook-reader-positions", "positions");
  const positions = await entries(posStore);
  for (const [bookId, data] of positions) {
    await recordChange({
      entity: "position",
      entityId: bookId as string,
      operation: "put",
      data,
      timestamp: ((data as Record<string, unknown>)?.updatedAt as number) ?? Date.now(),
    });
  }

  // 3. Highlights (key = highlightId, value = Highlight)
  const hlStore = createStore("ebook-reader-highlights", "highlights");
  const highlights = await entries(hlStore);
  for (const [id, data] of highlights) {
    const rec = data as Record<string, unknown>;
    // Skip soft-deleted highlights
    if (rec?.deletedAt) continue;
    await recordChange({
      entity: "highlight",
      entityId: id as string,
      operation: "put",
      data,
      timestamp: (rec?.updatedAt as number) ?? Date.now(),
    });
  }

  // 4. Notebooks (key = bookId, value = Notebook)
  const nbStore = createStore("ebook-reader-notebooks", "notebooks");
  const notebooks = await entries(nbStore);
  for (const [bookId, data] of notebooks) {
    await recordChange({
      entity: "notebook",
      entityId: bookId as string,
      operation: "put",
      data,
      timestamp: ((data as Record<string, unknown>)?.updatedAt as number) ?? Date.now(),
    });
  }

  // 5. Chat sessions (key = bookId, value = ChatSession[])
  const chatStore = createStore("ebook-reader-chat-sessions", "sessions");
  const sessions = await entries(chatStore);
  for (const [, sessionsForBook] of sessions) {
    const sessionList = sessionsForBook as ChatSession[];
    if (!Array.isArray(sessionList)) continue;
    for (const session of sessionList) {
      // Record session metadata (without messages)
      const { messages, ...metadata } = session;
      await recordChange({
        entity: "chat_session",
        entityId: session.id,
        operation: "put",
        data: metadata,
        timestamp: session.updatedAt ?? Date.now(),
      });
      // Record each message individually
      if (Array.isArray(messages)) {
        for (const msg of messages) {
          if (msg?.id) {
            await recordChange({
              entity: "chat_message",
              entityId: msg.id,
              operation: "put",
              data: { ...msg, sessionId: session.id },
              timestamp: msg.createdAt ?? Date.now(),
            });
          }
        }
      }
    }
  }

  // 6. Settings (from localStorage)
  try {
    const settingsRaw = localStorage.getItem("app-settings");
    if (settingsRaw) {
      const settings = JSON.parse(settingsRaw);
      await recordChange({
        entity: "settings",
        entityId: "user-settings",
        operation: "put",
        data: settings,
        timestamp: ((settings as Record<string, unknown>)?.updatedAt as number) ?? Date.now(),
      });
    }
  } catch {
    // Settings sync is best-effort
  }

  // Mark initial sync as done
  await set(INITIAL_SYNC_KEY, true, getFlagStore());
  console.log("[sync] Initial sync push complete — changes queued for push");
}
