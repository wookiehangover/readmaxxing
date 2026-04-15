import { createStore, get, set, clear } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import type { EntityType } from "./types";

// ---------------------------------------------------------------------------
// idb-keyval store (lazy-initialized for SSR safety)
// ---------------------------------------------------------------------------

let _cursorStore: ReturnType<typeof createStore> | null = null;

function getCursorStore(): UseStore {
  if (!_cursorStore) _cursorStore = createStore("ebook-reader-sync-cursors", "cursors");
  return _cursorStore;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the last-pulled cursor for an entity type.
 * Returns an ISO 8601 timestamp string, or null if never pulled.
 */
export async function getCursor(entityType: EntityType): Promise<string | null> {
  const value = await get<string>(entityType, getCursorStore());
  return value ?? null;
}

/**
 * Set the cursor for an entity type after a successful pull.
 */
export async function setCursor(entityType: EntityType, cursor: string): Promise<void> {
  await set(entityType, cursor, getCursorStore());
}

/**
 * Clear all cursors (e.g. on logout or full re-sync).
 */
export async function clearAllCursors(): Promise<void> {
  await clear(getCursorStore());
}
