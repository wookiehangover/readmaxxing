import { createStore, del, get, set } from "idb-keyval";
import type { UseStore } from "idb-keyval";

const CHAPTER_UPLOAD_CACHE_VERSION = 3;

let _store: ReturnType<typeof createStore> | null = null;

export function getChapterUploadCacheStore(): UseStore {
  if (!_store) {
    _store = createStore("ebook-reader-chapter-uploads", "uploaded");
  }
  return _store;
}

export async function isChaptersUploaded(bookId: string): Promise<boolean> {
  const marker = await get<number | boolean>(bookId, getChapterUploadCacheStore());
  return marker === CHAPTER_UPLOAD_CACHE_VERSION;
}

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
