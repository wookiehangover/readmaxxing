import { createStore, del, get, set } from "idb-keyval";
import type { UseStore } from "idb-keyval";

const CHAPTER_UPLOAD_CACHE_VERSION = 3;

/**
 * Tracks which books have had their extracted chapter text uploaded
 * to the server (POST /api/books/:bookId/chapters). Prevents re-uploading
 * on every book open.
 *
 * Lazy-initialized for SSR safety (idb-keyval createStore must not run
 * at module scope).
 */

let _store: ReturnType<typeof createStore> | null = null;

export function getChapterUploadCacheStore(): UseStore {
  if (!_store) {
    _store = createStore("ebook-reader-chapter-uploads", "uploaded");
  }
  return _store;
}

/**
 * Returns true if chapters for this book have already been uploaded.
 */
export async function isChaptersUploaded(bookId: string): Promise<boolean> {
  const marker = await get<number | boolean>(bookId, getChapterUploadCacheStore());
  return marker === CHAPTER_UPLOAD_CACHE_VERSION;
}

/**
 * Marks chapters for this book as uploaded so future opens skip re-upload.
 */
export async function markChaptersUploaded(bookId: string): Promise<void> {
  await set(bookId, CHAPTER_UPLOAD_CACHE_VERSION, getChapterUploadCacheStore());
}

export async function remapChapterUploadCache(
  fromId: string,
  toId: string,
  store: UseStore = getChapterUploadCacheStore(),
): Promise<void> {
  const marker = await get<number | boolean>(fromId, store);
  if (marker === CHAPTER_UPLOAD_CACHE_VERSION) {
    await set(toId, CHAPTER_UPLOAD_CACHE_VERSION, store);
  }
  if (marker !== undefined) await del(fromId, store);
}
