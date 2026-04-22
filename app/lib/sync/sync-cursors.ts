import { createStore, get, set, clear } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import type { EntityType, SyncCursor } from "./types";

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

/**
 * Rewind an ISO 8601 cursor by 1ms so the next pull overlaps the last one
 * by a single millisecond. This prevents silent data loss when two rows
 * share the same `updated_at` millisecond: the server query is `> since`,
 * so advancing the cursor to exactly `lastRow.updatedAt` would skip any
 * sibling row that happened to land on the same tick.
 *
 * Relies on the per-entity mergers being idempotent (re-delivering a row
 * that was already applied is a no-op). Returns the input unchanged when
 * it does not parse as a valid date.
 */
export function rewindCursor(cursor: string): string {
  const ms = Date.parse(cursor);
  if (isNaN(ms)) return cursor;
  return new Date(ms - 1).toISOString();
}

// ---------------------------------------------------------------------------
// Pull request cursor parsing (server-side)
// ---------------------------------------------------------------------------

/**
 * Supported entity types on the pull route. Kept here (vs. the route file)
 * so the pure parse helper can be unit-tested without importing server-only
 * database modules.
 */
const PULL_ENTITY_TYPES: readonly EntityType[] = [
  "book",
  "position",
  "highlight",
  "notebook",
  "chat_session",
  "chat_message",
  "settings",
] as const;

const EPOCH = new Date(0);

export interface ParsedPullCursors {
  /**
   * Per-entity `since` Dates. Every supported entity type is present;
   * entities absent from the client payload default to epoch
   * ("from the beginning").
   */
  cursorsByEntity: Record<EntityType, Date>;
  /** Populated when the `cursors` param is malformed. */
  error?: string;
}

/**
 * Parse the `cursors` pull query param into a per-entity `since` map.
 *
 * Wire format: a URL-encoded JSON array of `SyncCursor` entries, e.g.
 *
 *   [{ "entityType": "book", "cursor": "2026-04-22T12:00:00.000Z" }, ...]
 *
 * A missing param (or entity missing from the array) means "pull that
 * entity from the beginning" — preserved as epoch so fresh devices
 * keep their current behavior.
 */
export function parseCursorsParam(cursorsParam: string | null): ParsedPullCursors {
  const cursorsByEntity = {} as Record<EntityType, Date>;
  for (const t of PULL_ENTITY_TYPES) cursorsByEntity[t] = EPOCH;

  if (!cursorsParam) return { cursorsByEntity };

  let parsed: unknown;
  try {
    parsed = JSON.parse(cursorsParam);
  } catch {
    return { cursorsByEntity, error: "Invalid 'cursors' JSON" };
  }
  if (!Array.isArray(parsed)) {
    return { cursorsByEntity, error: "'cursors' must be a JSON array" };
  }

  for (const item of parsed) {
    if (!item || typeof item !== "object") {
      return { cursorsByEntity, error: "Invalid cursor entry" };
    }
    const { entityType, cursor } = item as Partial<SyncCursor>;
    if (typeof entityType !== "string" || !PULL_ENTITY_TYPES.includes(entityType as EntityType)) {
      return { cursorsByEntity, error: `Unknown entityType: ${String(entityType)}` };
    }
    if (typeof cursor !== "string") {
      return { cursorsByEntity, error: `Missing cursor for ${entityType}` };
    }
    const date = new Date(cursor);
    if (isNaN(date.getTime())) {
      return { cursorsByEntity, error: `Invalid cursor timestamp for ${entityType}` };
    }
    cursorsByEntity[entityType as EntityType] = date;
  }

  return { cursorsByEntity };
}
