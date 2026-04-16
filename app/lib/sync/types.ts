/**
 * Sync Protocol Types
 *
 * Cursor strategy: cursors are **per-entity-type**, not global.
 * Each EntityType has its own SyncCursor tracking the last-pulled timestamp.
 * This allows independent pull cadences and avoids re-scanning unchanged
 * entity types on every pull cycle.
 *
 * Merge strategies per entity type:
 * - book, reading_position, notebook, settings → LWW (last-write-wins by updatedAt)
 * - highlight → set_union (union by ID, tombstone-based deletion via deletedAt)
 * - chat_session → LWW for metadata
 * - chat_message → append_only (union by message ID, never remove)
 */

// ---------------------------------------------------------------------------
// Entity types
// ---------------------------------------------------------------------------

/** All syncable entity types. Matches server-side `readmax.sync_cursor.entity_type`. */
export type EntityType =
  | "book"
  | "highlight"
  | "notebook"
  | "chat_session"
  | "chat_message"
  | "position"
  | "settings";

// ---------------------------------------------------------------------------
// Change log
// ---------------------------------------------------------------------------

/** A single recorded mutation in the local change log (IDB). */
export interface ChangeEntry {
  /** ULID — provides both uniqueness and chronological ordering. */
  id: string;
  /** Which entity type was mutated. */
  entity: EntityType;
  /** Primary key of the mutated record. */
  entityId: string;
  /** Whether this was an upsert or a (soft) delete. */
  operation: "put" | "delete";
  /** Serialized snapshot of the record at mutation time. */
  data: unknown;
  /** Unix epoch ms when the mutation occurred. */
  timestamp: number;
  /** Whether this change has been successfully pushed to the server. */
  synced: boolean;
}

// ---------------------------------------------------------------------------
// Push protocol (client → server)
// ---------------------------------------------------------------------------

/** Batched changes sent from client to server. */
export interface SyncPushRequest {
  /** Ordered batch of unsynced changes. */
  changes: ChangeEntry[];
}

/** Server response after processing a push batch. */
export interface SyncPushResponse {
  /** IDs of changes the server accepted and persisted. */
  accepted: string[];
  /** IDs of changes the server rejected (e.g. conflict). */
  rejected: Array<{
    id: string;
    reason: string;
  }>;
  /** Server timestamp at the time of processing (ISO 8601). */
  serverTimestamp: string;
}

// ---------------------------------------------------------------------------
// Pull protocol (server → client)
// ---------------------------------------------------------------------------

/** Request parameters for pulling changes from the server. */
export interface SyncPullRequest {
  /** Per-entity-type cursors. Missing entries mean "pull everything". */
  cursors: SyncCursor[];
  /** Maximum number of records to return per entity type. */
  limit?: number;
}

/** Server response containing changes since the provided cursors. */
export interface SyncPullResponse {
  /** Changed records grouped by entity type. */
  changes: Array<{
    entity: EntityType;
    records: unknown[];
    /** Updated cursor value for this entity type (ISO 8601 timestamp). */
    cursor: string;
    /** Whether more records exist beyond the returned batch. */
    hasMore: boolean;
  }>;
  /** Server timestamp at the time of this response (ISO 8601). */
  serverTimestamp: string;
}

// ---------------------------------------------------------------------------
// Cursors
// ---------------------------------------------------------------------------

/** Tracks the last-pulled timestamp for a single entity type. */
export interface SyncCursor {
  entityType: EntityType;
  /** ISO 8601 timestamp of the most recently pulled record for this entity type. */
  cursor: string;
}

// ---------------------------------------------------------------------------
// Merge strategies
// ---------------------------------------------------------------------------

/**
 * Merge strategy identifiers used to declare how conflicts are resolved
 * for each entity type.
 *
 * - "lww"         — Last-Write-Wins: the record with the higher updatedAt wins.
 * - "set_union"   — Set union by ID; prefer non-deleted records over tombstones.
 * - "append_only" — Union by ID; records are never removed.
 */
export type MergeStrategy = "lww" | "set_union" | "append_only";

/** Maps each entity type to its merge strategy for documentation/runtime dispatch. */
export const ENTITY_MERGE_STRATEGIES: Record<EntityType, MergeStrategy> = {
  book: "lww",
  highlight: "set_union",
  notebook: "lww",
  chat_session: "lww",
  chat_message: "append_only",
  position: "lww",
  settings: "lww",
} as const;
