import { createStore, get, set } from "idb-keyval";

const CHAPTER_UPLOAD_CACHE_VERSION = 2;

/**
 * Tracks which books have had their extracted chapter text uploaded
 * to the server (POST /api/books/:bookId/chapters). Prevents re-uploading
 * on every book open.
 *
 * Lazy-initialized for SSR safety (idb-keyval createStore must not run
 * at module scope).
 */

let _store: ReturnType<typeof createStore> | null = null;

function getStore() {
  if (!_store) {
    _store = createStore("ebook-reader-chapter-uploads", "uploaded");
  }
  return _store;
}

/**
 * Returns true if chapters for this book have already been uploaded.
 */
export async function isChaptersUploaded(bookId: string): Promise<boolean> {
  const marker = await get<number | boolean>(bookId, getStore());
  return marker === CHAPTER_UPLOAD_CACHE_VERSION;
}

/**
 * Marks chapters for this book as uploaded so future opens skip re-upload.
 */
export async function markChaptersUploaded(bookId: string): Promise<void> {
  await set(bookId, CHAPTER_UPLOAD_CACHE_VERSION, getStore());
}
