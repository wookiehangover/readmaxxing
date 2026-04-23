import { get, set, del, entries } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import { appendOnlyMerge, lwwMerge } from "./merge";
import {
  getActiveSessionStore,
  getBookDataStore,
  getBookStore,
  getChatSessionStore,
  getHighlightStore,
  getNotebookStore,
  getPositionStore,
} from "./stores";

export interface RemapStores {
  readonly bookStore: UseStore;
  readonly bookDataStore: UseStore;
  readonly positionStore: UseStore;
  readonly highlightStore: UseStore;
  readonly notebookStore: UseStore;
  readonly chatSessionStore: UseStore;
  readonly activeSessionStore: UseStore;
}

let _defaults: RemapStores | null = null;
function getDefaultStores(): RemapStores {
  if (!_defaults) {
    _defaults = {
      bookStore: getBookStore(),
      bookDataStore: getBookDataStore(),
      positionStore: getPositionStore(),
      highlightStore: getHighlightStore(),
      notebookStore: getNotebookStore(),
      chatSessionStore: getChatSessionStore(),
      activeSessionStore: getActiveSessionStore(),
    };
  }
  return _defaults;
}

interface ChatMessageLike {
  id: string;
  [k: string]: unknown;
}

interface ChatSessionLike {
  id: string;
  bookId: string;
  messages: ChatMessageLike[];
  updatedAt: number;
  [k: string]: unknown;
}

function mergeSessionArrays(a: ChatSessionLike[], b: ChatSessionLike[]): ChatSessionLike[] {
  const byId = new Map<string, ChatSessionLike>();
  for (const s of a) byId.set(s.id, s);
  for (const s of b) {
    const existing = byId.get(s.id);
    if (!existing) {
      byId.set(s.id, s);
      continue;
    }
    const messages = appendOnlyMerge<ChatMessageLike>(
      existing.messages ?? [],
      s.messages ?? [],
      (m) => m.id,
    );
    const winner = s.updatedAt >= existing.updatedAt ? s : existing;
    byId.set(s.id, { ...winner, messages });
  }
  return Array.from(byId.values());
}

/**
 * Remap all local references from `fromId` to `toId` when cross-device
 * dedup identifies a canonical book id. Moves book data, merges positions,
 * notebooks, highlights, chat sessions, and the active-session pointer,
 * then tombstones the losing book record locally. Idempotent.
 */
export async function remapBookId(
  fromId: string,
  toId: string,
  stores: RemapStores = getDefaultStores(),
): Promise<void> {
  if (!fromId || !toId || fromId === toId) return;

  const {
    bookStore,
    bookDataStore,
    positionStore,
    highlightStore,
    notebookStore,
    chatSessionStore,
    activeSessionStore,
  } = stores;

  const fromData = await get<ArrayBuffer>(fromId, bookDataStore);
  if (fromData) {
    const toData = await get<ArrayBuffer>(toId, bookDataStore);
    if (!toData) await set(toId, fromData, bookDataStore);
    await del(fromId, bookDataStore);
  }

  const fromPos = await get<{ cfi: string; updatedAt: number }>(fromId, positionStore);
  if (fromPos) {
    const toPos = await get<{ cfi: string; updatedAt: number }>(toId, positionStore);
    const winner = toPos ? lwwMerge(toPos, fromPos) : fromPos;
    if (winner !== toPos) await set(toId, winner, positionStore);
    await del(fromId, positionStore);
  }

  const fromNotebook = await get<{ bookId: string; updatedAt: number; content: unknown }>(
    fromId,
    notebookStore,
  );
  if (fromNotebook) {
    const rewritten = { ...fromNotebook, bookId: toId };
    const toNotebook = await get<{ bookId: string; updatedAt: number; content: unknown }>(
      toId,
      notebookStore,
    );
    const winner = toNotebook ? lwwMerge(toNotebook, rewritten) : rewritten;
    if (winner !== toNotebook) await set(toId, winner, notebookStore);
    await del(fromId, notebookStore);
  }

  const allHighlights = await entries<string, Record<string, unknown>>(highlightStore);
  for (const [hId, h] of allHighlights) {
    if (!h || h.bookId !== fromId) continue;
    await set(hId, { ...h, bookId: toId }, highlightStore);
  }

  const fromSessions = await get<ChatSessionLike[]>(fromId, chatSessionStore);
  if (fromSessions && fromSessions.length > 0) {
    const toSessions = (await get<ChatSessionLike[]>(toId, chatSessionStore)) ?? [];
    const remapped = fromSessions.map((s) => ({ ...s, bookId: toId }));
    const merged = mergeSessionArrays(toSessions, remapped);
    await set(toId, merged, chatSessionStore);
    await del(fromId, chatSessionStore);
  }

  const fromActive = await get<string>(fromId, activeSessionStore);
  if (fromActive) {
    const toActive = await get<string>(toId, activeSessionStore);
    if (!toActive) await set(toId, fromActive, activeSessionStore);
    await del(fromId, activeSessionStore);
  }

  const fromBook = await get<Record<string, unknown>>(fromId, bookStore);
  if (fromBook && fromBook.deletedAt == null) {
    const now = Date.now();
    await set(fromId, { ...fromBook, deletedAt: now, updatedAt: now }, bookStore);
  }
}
