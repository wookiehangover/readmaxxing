import { createStore } from "idb-keyval";
import type { UseStore } from "idb-keyval";

// Lazy-initialized IDB store accessors. Module-scope `createStore()` calls
// fail during SSR because `indexedDB` is undefined in Node, so each store is
// created on first access. idb-keyval limits one object store per database,
// which is why we have a separate database per entity.

let _bookStore: UseStore | null = null;
let _bookDataStore: UseStore | null = null;
let _positionStore: UseStore | null = null;
let _highlightStore: UseStore | null = null;
let _notebookStore: UseStore | null = null;
let _chatSessionStore: UseStore | null = null;
let _activeSessionStore: UseStore | null = null;
let _chatMessagesStore: UseStore | null = null;
let _syncFlagsStore: UseStore | null = null;

/** Book metadata (BookMeta records, key = bookId). */
export function getBookStore(): UseStore {
  if (!_bookStore) _bookStore = createStore("ebook-reader-db", "books");
  return _bookStore;
}

/** Book binary data (ArrayBuffer epub/pdf payloads, key = bookId). */
export function getBookDataStore(): UseStore {
  if (!_bookDataStore) _bookDataStore = createStore("ebook-reader-book-data", "book-data");
  return _bookDataStore;
}

/** Reading positions (PositionRecord, key = bookId). */
export function getPositionStore(): UseStore {
  if (!_positionStore) _positionStore = createStore("ebook-reader-positions", "positions");
  return _positionStore;
}

/** Highlights (Highlight records, key = highlightId). */
export function getHighlightStore(): UseStore {
  if (!_highlightStore) _highlightStore = createStore("ebook-reader-highlights", "highlights");
  return _highlightStore;
}

/** Notebooks (Notebook records, key = bookId). */
export function getNotebookStore(): UseStore {
  if (!_notebookStore) _notebookStore = createStore("ebook-reader-notebooks", "notebooks");
  return _notebookStore;
}

/** Chat session metadata (ChatSession[] per book, key = bookId). */
export function getChatSessionStore(): UseStore {
  if (!_chatSessionStore) _chatSessionStore = createStore("ebook-reader-chat-sessions", "sessions");
  return _chatSessionStore;
}

/** Active chat session pointer (sessionId string, key = bookId). */
export function getActiveSessionStore(): UseStore {
  if (!_activeSessionStore)
    _activeSessionStore = createStore("ebook-reader-active-session", "active-session");
  return _activeSessionStore;
}

/**
 * Legacy pre-session chat messages store. Read-only for backward-compat
 * migration in chat-store.ts; new writes go to the session-based stores.
 */
export function getChatMessagesStore(): UseStore {
  if (!_chatMessagesStore) _chatMessagesStore = createStore("ebook-reader-chats", "chats");
  return _chatMessagesStore;
}

/** Sync bookkeeping flags (e.g. "initial-sync-complete"). */
export function getSyncFlagsStore(): UseStore {
  if (!_syncFlagsStore) _syncFlagsStore = createStore("ebook-reader-sync-flags", "flags");
  return _syncFlagsStore;
}
