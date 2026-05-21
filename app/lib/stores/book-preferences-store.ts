import { createStore, get, set } from "idb-keyval";

export interface BookPreferences {
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  textAlign?: "left" | "center" | "right" | "justify";
  readerLayout?: "single" | "spread" | "scroll";
  pdfLayout?: "original" | "fit-height" | "fit-width" | "two-page" | "continuous";
}

let _store: ReturnType<typeof createStore> | null = null;

function getStore() {
  if (!_store) _store = createStore("ebook-reader-book-prefs", "prefs");
  return _store;
}

export async function getBookPreferences(bookId: string): Promise<BookPreferences | undefined> {
  return get<BookPreferences>(bookId, getStore());
}

export async function saveBookPreferences(bookId: string, prefs: BookPreferences): Promise<void> {
  return set(bookId, prefs, getStore());
}
