import { createStore } from "idb-keyval";
import type { UseStore } from "idb-keyval";

let _bookStore: UseStore | null = null;
let _bookDataStore: UseStore | null = null;
let _positionStore: UseStore | null = null;
let _remotePositionStore: UseStore | null = null;
let _readingHistoryStore: UseStore | null = null;
let _highlightStore: UseStore | null = null;
let _bookmarkStore: UseStore | null = null;
let _notebookStore: UseStore | null = null;
let _chatSessionStore: UseStore | null = null;
let _activeSessionStore: UseStore | null = null;
let _chatMessagesStore: UseStore | null = null;
let _syncFlagsStore: UseStore | null = null;
let _chapterQuestionsStore: UseStore | null = null;
let _reviewsStore: UseStore | null = null;

export function getBookStore(): UseStore {
  if (!_bookStore) _bookStore = createStore("ebook-reader-db", "books");
  return _bookStore;
}

export function getBookDataStore(): UseStore {
  if (!_bookDataStore) _bookDataStore = createStore("ebook-reader-book-data", "book-data");
  return _bookDataStore;
}

export function getPositionStore(): UseStore {
  if (!_positionStore) _positionStore = createStore("ebook-reader-positions", "positions");
  return _positionStore;
}

export function getRemotePositionStore(): UseStore {
  if (!_remotePositionStore)
    _remotePositionStore = createStore("ebook-reader-remote-positions", "positions");
  return _remotePositionStore;
}

export function getReadingHistoryStore(): UseStore {
  if (!_readingHistoryStore)
    _readingHistoryStore = createStore("ebook-reader-reading-history", "history");
  return _readingHistoryStore;
}

export function getHighlightStore(): UseStore {
  if (!_highlightStore) _highlightStore = createStore("ebook-reader-highlights", "highlights");
  return _highlightStore;
}

export function getBookmarkStore(): UseStore {
  if (!_bookmarkStore) _bookmarkStore = createStore("ebook-reader-bookmarks", "bookmarks");
  return _bookmarkStore;
}

export function getNotebookStore(): UseStore {
  if (!_notebookStore) _notebookStore = createStore("ebook-reader-notebooks", "notebooks");
  return _notebookStore;
}

export function getChatSessionStore(): UseStore {
  if (!_chatSessionStore) _chatSessionStore = createStore("ebook-reader-chat-sessions", "sessions");
  return _chatSessionStore;
}

export function getActiveSessionStore(): UseStore {
  if (!_activeSessionStore)
    _activeSessionStore = createStore("ebook-reader-active-session", "active-session");
  return _activeSessionStore;
}

export function getChatMessagesStore(): UseStore {
  if (!_chatMessagesStore) _chatMessagesStore = createStore("ebook-reader-chats", "chats");
  return _chatMessagesStore;
}

export function getSyncFlagsStore(): UseStore {
  if (!_syncFlagsStore) _syncFlagsStore = createStore("ebook-reader-sync-flags", "flags");
  return _syncFlagsStore;
}

export function getChapterQuestionsStore(): UseStore {
  if (!_chapterQuestionsStore)
    _chapterQuestionsStore = createStore("ebook-reader-chapter-questions", "questions");
  return _chapterQuestionsStore;
}

export function getReviewsStore(): UseStore {
  if (!_reviewsStore) _reviewsStore = createStore("ebook-reader-reviews", "reviews");
  return _reviewsStore;
}
