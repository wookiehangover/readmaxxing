import { custodyUpdate } from "~/lib/sync/custody-write";
import { get, set, update } from "idb-keyval";
import { DEMO_BOOK_ID, DEMO_CHAT_SESSION } from "./demo-content";
import type { BookMeta } from "~/lib/stores/book-store";
import type { ChatSession } from "~/lib/stores/chat-store";
import { getUnsyncedChanges, retainRemapReplay } from "~/lib/sync/change-log";
import { appendOnlyMerge, setUnionMerge } from "~/lib/sync/merge";
import { moveRemapRecord } from "~/lib/sync/remap-records";
import { referencesRemappedBook } from "~/lib/sync/remap-references";
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

async function assertAdoptionOwner(userId: string, intent?: DemoAdoptionIntent): Promise<void> {
  if (intent && intent.ownerId !== userId)
    throw new Error("Demo adoption belongs to another account.");
  const remaps = (await getBookRemaps()).filter((remap) => remap.fromId === DEMO_BOOK_ID);
  if (remaps.some((remap) => remap.ownerId !== userId || remap.toId !== intent?.bookId)) {
    throw new Error("Demo adoption ownership conflicts with retained recovery evidence.");
  }
  const pending = await getUnsyncedChanges();
  if (
    pending.some((change) => {
      if (!change.ownerId || change.ownerId === userId) return false;
      const data = change.data as Record<string, unknown> | undefined;
      return (
        referencesRemappedBook(change, { fromId: DEMO_BOOK_ID, toId: DEMO_BOOK_ID }) ||
        change.entityId === DEMO_CHAT_SESSION.id ||
        data?.sessionId === DEMO_CHAT_SESSION.id
      );
    })
  ) {
    throw new Error("Demo adoption belongs to another account.");
  }
}

export async function rewriteReservedDemoChanges(userId: string): Promise<void> {
  const intent = await get<DemoAdoptionIntent>(ADOPTION_KEY, getSyncFlagsStore());
  if (!intent || intent.ownerId !== userId) return;
  await assertAdoptionOwner(userId, intent);
  for (const pending of await getUnsyncedChanges(userId)) {
    await custodyUpdate<ChangeEntry>(
      pending.id,
      (change) => {
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
            return {
              ...change,
              entityId,
              data,
              ownerId: intent.ownerId,
              revision: (change.revision ?? 0) + 1,
            };
          }
        }
        return change;
      },
      getChangeLogStore(),
      { ownerId: userId },
    );
  }
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

export async function repairAdoptedDemoSessions(
  userId: string,
  isStopped?: () => boolean,
): Promise<void> {
  const checkActive = () => {
    if (isStopped?.()) throw new Error("Demo session repair stopped; recovery evidence retained.");
  };
  checkActive();
  const intent = await get<DemoAdoptionIntent>(ADOPTION_KEY, getSyncFlagsStore());
  if (!intent || intent.ownerId !== userId) return;
  await assertAdoptionOwner(userId, intent);
  const { bookId } = await resolveAdoptedDemo(userId);
  type Session = ChatSession & { deletedAt?: number | null };
  const repair = (sessions: Session[]): Session[] => {
    const reserved = sessions.find((session) => session.id === DEMO_CHAT_SESSION.id);
    if (!reserved) return sessions;
    const existing = sessions.find((session) => session.id === intent.sessionId);
    const existingMessages = existing?.messages ?? [];
    const existingIds = new Set(existingMessages.map((message) => message.id));
    const renamed = {
      ...reserved,
      id: intent.sessionId,
      bookId,
    };
    const merged = setUnionMerge(existing ? [existing] : [], [renamed], (session) => session.id)[0];
    return sessions
      .filter((session) => session.id !== reserved.id && session.id !== intent.sessionId)
      .concat({
        ...merged,
        messages: appendOnlyMerge(
          existingMessages,
          (reserved.messages ?? []).filter((message) => !existingIds.has(message.id)),
          (message) => message.id,
        ),
      });
  };
  const repaired = await moveRemapRecord<Session[]>(getChatSessionStore(), bookId, bookId, repair, {
    checkActive,
    matches: (sessions) => sessions.some((session) => session.id === DEMO_CHAT_SESSION.id),
    prepare: async (sessions) => {
      const session = repair(sessions).find((candidate) => candidate.id === intent.sessionId)!;
      await retainRemapReplay(
        userId,
        { fromId: DEMO_BOOK_ID, toId: bookId },
        {
          entity: "chat_session",
          entityId: session.id,
          operation: session.deletedAt != null ? "delete" : "put",
          data: session,
          timestamp: session.updatedAt,
        },
      );
    },
  });
  checkActive();
  const activeSessionId = await get<string>(bookId, getActiveSessionStore());
  const sessions = (await get<ChatSession[]>(bookId, getChatSessionStore())) ?? [];
  checkActive();
  await update<string | undefined>(
    bookId,
    (active) =>
      active !== activeSessionId || sessions.some((session) => session.id === active)
        ? active
        : (sessions.find((session) => session.id === intent.sessionId)?.id ?? sessions[0]?.id),
    getActiveSessionStore(),
  );
  if (repaired && typeof window !== "undefined")
    queueMicrotask(() => {
      if (!isStopped?.())
        window.dispatchEvent(
          new CustomEvent("sync:entity-updated", {
            detail: { entity: "chat_session" },
          }),
        );
    });
}

export async function prepareAdoptedDemoContent(userId: string): Promise<AdoptedDemo> {
  return withSyncIdentityLock(async () => {
    let intent = await get<DemoAdoptionIntent>(ADOPTION_KEY, getSyncFlagsStore());
    await assertAdoptionOwner(userId, intent);
    if (!intent) {
      const [book, data, sessions] = await Promise.all([
        get<BookMeta>(DEMO_BOOK_ID, getBookStore()),
        get<ArrayBuffer>(DEMO_BOOK_ID, getBookDataStore()),
        get<ChatSession[]>(DEMO_BOOK_ID, getChatSessionStore()),
      ]);
      if (!book || book.deletedAt != null || !data || !sessions?.length) {
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
    await repairAdoptedDemoSessions(userId);
    await set(ADOPTION_KEY, { ...adopted, prepared: true }, getSyncFlagsStore());
    return resolveAdoptedDemo(userId);
  });
}
