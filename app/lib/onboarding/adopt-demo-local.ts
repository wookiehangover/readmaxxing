import { get, set, update, promisifyRequest } from "idb-keyval";
import { DEMO_BOOK_ID, DEMO_CHAT_SESSION } from "./demo-content";
import type { BookMeta } from "~/lib/stores/book-store";
import type { ChatSession } from "~/lib/stores/chat-store";
import { retainRemapReplay } from "~/lib/sync/change-log";
import { getBookRemaps, persistBookRemap, resumeBookRemaps } from "~/lib/sync/remap-journal";
import { withSyncIdentityLock } from "~/lib/sync/sync-lock";
import {
  getActiveSessionStore,
  getBookDataStore,
  getBookStore,
  getChangeLogStore,
  getChatSessionStore,
  getSyncFlagsStore,
} from "~/lib/sync/stores";
import type { ChangeEntry } from "~/lib/sync/types";

const ADOPTION_KEY = "demo-adoption";

interface DemoAdoptionIntent {
  ownerId: string;
  bookId: string;
  sessionId: string;
  prepared: boolean;
}

type LocalBook = BookMeta & { canonicalId?: string };

export interface AdoptedDemo {
  bookId: string;
  sessionId: string;
}

export async function rewriteReservedDemoChanges(userId: string): Promise<void> {
  const intent = await get<DemoAdoptionIntent>(ADOPTION_KEY, getSyncFlagsStore());
  if (!intent || intent.ownerId !== userId) return;
  await getChangeLogStore()("readwrite", (store) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const change = cursor.value as ChangeEntry;
      if (
        change &&
        change.synced === false &&
        (!change.ownerId || change.ownerId === intent.ownerId)
      ) {
        let entityId = change.entityId;
        let data = change.data;
        if (change.entity === "book" && entityId === DEMO_BOOK_ID) {
          const book = data as LocalBook | undefined;
          if (!book?.canonicalId) {
            entityId = intent.bookId;
            if (book) data = { ...book, id: entityId };
          }
        }
        if (change.entity === "chat_session" && entityId === DEMO_CHAT_SESSION.id)
          entityId = intent.sessionId;
        if (data && typeof data === "object" && change.entity !== "settings") {
          const record = data as Record<string, unknown>;
          if (record.id === DEMO_CHAT_SESSION.id) data = { ...record, id: intent.sessionId };
          if (record.sessionId === DEMO_CHAT_SESSION.id)
            data = { ...(data as object), sessionId: intent.sessionId };
        }
        if (data !== change.data || entityId !== change.entityId) {
          cursor.update({
            ...change,
            entityId,
            data,
            ownerId: intent.ownerId,
            revision: (change.revision ?? 0) + 1,
          });
        }
      }
      cursor.continue();
    };
    return promisifyRequest(store.transaction);
  });
}

export async function resolveAdoptedDemo(userId: string): Promise<AdoptedDemo> {
  const intent = await get<DemoAdoptionIntent>(ADOPTION_KEY, getSyncFlagsStore());
  if (!intent || intent.ownerId !== userId)
    throw new Error("Demo adoption belongs to another account.");
  const remaps = await getBookRemaps(userId);
  let bookId = intent.bookId;
  const visited = new Set<string>();
  while (!visited.has(bookId)) {
    visited.add(bookId);
    const next = remaps.find((remap) => remap.fromId === bookId);
    if (!next) break;
    bookId = next.toId;
  }
  const activeSessionId = await get<string>(bookId, getActiveSessionStore());
  return {
    bookId,
    sessionId:
      activeSessionId && activeSessionId !== DEMO_CHAT_SESSION.id
        ? activeSessionId
        : intent.sessionId,
  };
}

export async function prepareAdoptedDemoContent(userId: string): Promise<AdoptedDemo> {
  return withSyncIdentityLock(async () => {
    let intent = await get<DemoAdoptionIntent>(ADOPTION_KEY, getSyncFlagsStore());
    if (intent && intent.ownerId !== userId)
      throw new Error("Demo adoption belongs to another account.");
    if (!intent) {
      const [book, data, sessions] = await Promise.all([
        get<BookMeta>(DEMO_BOOK_ID, getBookStore()),
        get<ArrayBuffer>(DEMO_BOOK_ID, getBookDataStore()),
        get<ChatSession[]>(DEMO_BOOK_ID, getChatSessionStore()),
      ]);
      if (
        !book ||
        book.deletedAt != null ||
        !data ||
        !sessions?.length
      ) {
        throw new Error("The demo library is incomplete. Reload the page and try again.");
      }
      intent = {
        ownerId: userId,
        bookId: crypto.randomUUID(),
        sessionId: crypto.randomUUID(),
        prepared: false,
      };
      await set(ADOPTION_KEY, intent, getSyncFlagsStore());
    }
    const adopted = intent;
    await rewriteReservedDemoChanges(userId);
    if (!adopted.prepared) {
      const original = await get<LocalBook>(DEMO_BOOK_ID, getBookStore());
      if (!original) throw new Error("The demo book is missing; adoption progress was retained.");
      const book = { ...original, id: adopted.bookId };
      delete book.canonicalId;
      if (original.canonicalId === adopted.bookId) delete book.deletedAt;
      await update<BookMeta>(adopted.bookId, (existing) => existing ?? book, getBookStore());
      await retainRemapReplay(
        userId,
        { fromId: DEMO_BOOK_ID, toId: adopted.bookId },
        {
          entity: "book",
          entityId: adopted.bookId,
          operation: book.deletedAt != null ? "delete" : "put",
          data: book,
          timestamp: book.updatedAt ?? Number.NaN,
        },
      );
    }
    await update<ChatSession[] | undefined>(
      DEMO_BOOK_ID,
      (sessions) =>
        sessions?.map((session) =>
          session.id === DEMO_CHAT_SESSION.id ? { ...session, id: adopted.sessionId } : session,
        ),
      getChatSessionStore(),
    );
    await update<string | undefined>(
      DEMO_BOOK_ID,
      (active) => (active === DEMO_CHAT_SESSION.id ? adopted.sessionId : active),
      getActiveSessionStore(),
    );
    await persistBookRemap(userId, DEMO_BOOK_ID, adopted.bookId);
    await resumeBookRemaps(userId);
    const result = await resolveAdoptedDemo(userId);
    const sessions = (await get<ChatSession[]>(result.bookId, getChatSessionStore())) ?? [];
    await update<string | undefined>(result.bookId,
      (active) => sessions.some((session) => session.id === active) ? active :
        sessions.find((session) => session.id === adopted.sessionId)?.id ?? sessions[0]?.id,
      getActiveSessionStore());
    await set(ADOPTION_KEY, { ...adopted, prepared: true }, getSyncFlagsStore());
    return resolveAdoptedDemo(userId);
  });
}
