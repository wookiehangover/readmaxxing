import { get, set, entries } from "idb-keyval";
import { recordChange } from "./change-log";
import {
  getBookStore,
  getChatSessionStore,
  getHighlightStore,
  getNotebookStore,
  getPositionStore,
  getSyncFlagsStore,
} from "./stores";
import type { ChatSession } from "~/lib/stores/chat-store";

const INITIAL_SYNC_KEY = "initial-sync-complete";

/**
 * Returns `[key, value]` for a well-formed IDB entry, or `null` for anything
 * malformed (non-tuple, missing slots, null/undefined value). Skipping rather
 * than throwing lets a single corrupt record not kill the whole sync scan.
 */
function safeEntry(entry: unknown): [IDBValidKey, unknown] | null {
  if (!Array.isArray(entry) || entry.length < 2) return null;
  if (entry[1] == null) return null;
  return [entry[0] as IDBValidKey, entry[1]];
}

/**
 * One-time scan of all IDB stores to create change-log entries for
 * existing data. This ensures users who had data before the sync
 * feature was added get their data pushed to the server on first sync.
 */
export async function runInitialSyncIfNeeded(): Promise<void> {
  const done = await get(INITIAL_SYNC_KEY, getSyncFlagsStore());
  if (done) return;

  console.log("[sync] Running initial sync push for existing data...");

  // 1. Books (key = bookId, value = BookMeta)
  const bookStore = getBookStore();
  const books = await entries(bookStore);
  for (const entry of books) {
    const tuple = safeEntry(entry);
    if (!tuple) continue;
    const [id, data] = tuple;
    await recordChange({
      entity: "book",
      entityId: id as string,
      operation: "put",
      data,
      timestamp: ((data as Record<string, unknown>)?.updatedAt as number) ?? Date.now(),
    });
  }

  // 2. Reading positions (key = bookId, value = PositionRecord)
  const posStore = getPositionStore();
  const positions = await entries(posStore);
  for (const entry of positions) {
    const tuple = safeEntry(entry);
    if (!tuple) continue;
    const [bookId, data] = tuple;
    await recordChange({
      entity: "position",
      entityId: bookId as string,
      operation: "put",
      data,
      timestamp: ((data as Record<string, unknown>)?.updatedAt as number) ?? Date.now(),
    });
  }

  // 3. Highlights (key = highlightId, value = Highlight)
  const hlStore = getHighlightStore();
  const highlights = await entries(hlStore);
  for (const entry of highlights) {
    const tuple = safeEntry(entry);
    if (!tuple) continue;
    const [id, data] = tuple;
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
  const nbStore = getNotebookStore();
  const notebooks = await entries(nbStore);
  for (const entry of notebooks) {
    const tuple = safeEntry(entry);
    if (!tuple) continue;
    const [bookId, data] = tuple;
    await recordChange({
      entity: "notebook",
      entityId: bookId as string,
      operation: "put",
      data,
      timestamp: ((data as Record<string, unknown>)?.updatedAt as number) ?? Date.now(),
    });
  }

  // 5. Chat sessions (key = bookId, value = ChatSession[])
  const chatStore = getChatSessionStore();
  const sessions = await entries(chatStore);
  for (const entry of sessions) {
    const tuple = safeEntry(entry);
    if (!tuple) continue;
    const sessionList = tuple[1] as ChatSession[];
    if (!Array.isArray(sessionList)) continue;
    for (const session of sessionList) {
      if (!session || typeof session !== "object") continue;
      // Record session metadata only. Chat messages are server-authoritative
      // and persisted by /api/chat — they must not be pushed from clients.
      const { messages: _messages, ...metadata } = session;
      await recordChange({
        entity: "chat_session",
        entityId: session.id,
        operation: "put",
        data: metadata,
        timestamp: session.updatedAt ?? Date.now(),
      });
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
  await set(INITIAL_SYNC_KEY, true, getSyncFlagsStore());
  console.log("[sync] Initial sync push complete — changes queued for push");
}
