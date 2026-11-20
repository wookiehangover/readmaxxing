import { get, set, entries } from "idb-keyval";
import { DEMO_BOOK_ID, DEMO_CHAT_SESSION } from "~/lib/onboarding/demo-content";
import { SYNCED_SETTINGS_KEYS } from "~/lib/settings";
import { getUnsyncedChanges, recordChange } from "./change-log";
import {
  getBookDataStore,
  getBookStore,
  getBookmarkStore,
  getChatSessionStore,
  getHighlightStore,
  getNotebookStore,
  getPositionStore,
  getSyncFlagsStore,
} from "./stores";
import type { ChatSession } from "~/lib/stores/chat-store";

const INITIAL_SYNC_KEY = "initial-sync-complete";

function safeEntry(entry: unknown): [IDBValidKey, unknown] | null {
  if (!Array.isArray(entry) || entry.length < 2) return null;
  if (entry[1] == null) return null;
  return [entry[0] as IDBValidKey, entry[1]];
}

async function queueStrandedBooks(): Promise<void> {
  const pendingBookIds = new Set(
    (await getUnsyncedChanges())
      .filter((change) => change.entity === "book")
      .map((change) => change.entityId),
  );
  const books = await entries(getBookStore());
  const bookDataStore = getBookDataStore();

  for (const entry of books) {
    const tuple = safeEntry(entry);
    if (!tuple) continue;

    const [id, data] = tuple;
    if (typeof id !== "string" || id === DEMO_BOOK_ID || pendingBookIds.has(id)) continue;
    if (typeof data !== "object") continue;

    const book = data as Record<string, unknown>;
    if (book.deletedAt != null || book.remoteFileUrl) continue;
    if (!(await get(id, bookDataStore))) continue;

    await recordChange({
      entity: "book",
      entityId: id,
      operation: "put",
      data,
      timestamp: typeof book.updatedAt === "number" ? book.updatedAt : Date.now(),
    });
    pendingBookIds.add(id);
  }
}

export async function runInitialSyncIfNeeded(): Promise<void> {
  const done = await get(INITIAL_SYNC_KEY, getSyncFlagsStore());
  if (done) {
    await queueStrandedBooks();
    return;
  }

  console.log("[sync] Running initial sync push for existing data...");

  const bookStore = getBookStore();
  const books = await entries(bookStore);
  for (const entry of books) {
    const tuple = safeEntry(entry);
    if (!tuple) continue;
    const [id, data] = tuple;
    if (id === DEMO_BOOK_ID) continue;
    await recordChange({
      entity: "book",
      entityId: id as string,
      operation: "put",
      data,
      timestamp: ((data as Record<string, unknown>)?.updatedAt as number) ?? Date.now(),
    });
  }

  const posStore = getPositionStore();
  const positions = await entries(posStore);
  for (const entry of positions) {
    const tuple = safeEntry(entry);
    if (!tuple) continue;
    const [bookId, data] = tuple;
    if (bookId === DEMO_BOOK_ID) continue;
    await recordChange({
      entity: "position",
      entityId: bookId as string,
      operation: "put",
      data,
      timestamp: ((data as Record<string, unknown>)?.updatedAt as number) ?? Date.now(),
    });
  }

  const hlStore = getHighlightStore();
  const highlights = await entries(hlStore);
  for (const entry of highlights) {
    const tuple = safeEntry(entry);
    if (!tuple) continue;
    const [id, data] = tuple;
    const rec = data as Record<string, unknown>;
    if (rec?.deletedAt || rec?.bookId === DEMO_BOOK_ID) continue;
    await recordChange({
      entity: "highlight",
      entityId: id as string,
      operation: "put",
      data,
      timestamp: (rec?.updatedAt as number) ?? Date.now(),
    });
  }

  const bookmarkStore = getBookmarkStore();
  const bookmarks = await entries(bookmarkStore);
  for (const entry of bookmarks) {
    const tuple = safeEntry(entry);
    if (!tuple) continue;
    const [id, data] = tuple;
    const rec = data as Record<string, unknown>;
    if (rec?.deletedAt || rec?.bookId === DEMO_BOOK_ID) continue;
    await recordChange({
      entity: "bookmark",
      entityId: id as string,
      operation: "put",
      data,
      timestamp: (rec?.updatedAt as number) ?? Date.now(),
    });
  }

  const nbStore = getNotebookStore();
  const notebooks = await entries(nbStore);
  for (const entry of notebooks) {
    const tuple = safeEntry(entry);
    if (!tuple) continue;
    const [bookId, data] = tuple;
    if (bookId === DEMO_BOOK_ID) continue;
    await recordChange({
      entity: "notebook",
      entityId: bookId as string,
      operation: "put",
      data,
      timestamp: ((data as Record<string, unknown>)?.updatedAt as number) ?? Date.now(),
    });
  }

  const chatStore = getChatSessionStore();
  const sessions = await entries(chatStore);
  for (const entry of sessions) {
    const tuple = safeEntry(entry);
    if (!tuple) continue;
    if (tuple[0] === DEMO_BOOK_ID) continue;
    const sessionList = tuple[1] as ChatSession[];
    if (!Array.isArray(sessionList)) continue;
    for (const session of sessionList) {
      if (!session || typeof session !== "object") continue;
      if (session.bookId === DEMO_BOOK_ID || session.id === DEMO_CHAT_SESSION.id) continue;
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

  try {
    const settingsRaw = localStorage.getItem("app-settings");
    if (settingsRaw) {
      const settings = JSON.parse(settingsRaw) as Record<string, unknown>;
      const synced: Record<string, unknown> = {};
      for (const key of SYNCED_SETTINGS_KEYS) {
        if (key in settings) synced[key] = settings[key];
      }
      if (Object.keys(synced).length > 0) {
        const updatedAt = typeof settings.updatedAt === "number" ? settings.updatedAt : Date.now();
        synced.updatedAt = updatedAt;
        await recordChange({
          entity: "settings",
          entityId: "user-settings",
          operation: "put",
          data: synced,
          timestamp: updatedAt,
        });
      }
    }
  } catch {}

  await set(INITIAL_SYNC_KEY, true, getSyncFlagsStore());
  console.log("[sync] Initial sync push complete — changes queued for push");
}
