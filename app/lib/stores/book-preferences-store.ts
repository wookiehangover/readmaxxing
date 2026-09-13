import { createStore, get, update } from "idb-keyval";
import type { FontWeight } from "~/lib/settings";

export interface BookPreferences {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: FontWeight;
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
  // Merge explicit changes atomically so unrelated settings keep inheriting defaults
  // and overlapping edits cannot overwrite each other.
  return update<BookPreferences>(bookId, (current) => ({ ...current, ...prefs }), getStore());
}
