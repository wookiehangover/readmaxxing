import { createStore, get, set, clear } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import type { EntityType, SyncCursor } from "./types";

let _cursorStore: ReturnType<typeof createStore> | null = null;

function getCursorStore(): UseStore {
  if (!_cursorStore) _cursorStore = createStore("ebook-reader-sync-cursors", "cursors");
  return _cursorStore;
}

export async function getCursor(entityType: EntityType): Promise<string | null> {
  const value = await get<string>(entityType, getCursorStore());
  return value ?? null;
}

export async function setCursor(entityType: EntityType, cursor: string): Promise<void> {
  await set(entityType, cursor, getCursorStore());
}

export async function clearAllCursors(): Promise<void> {
  await clear(getCursorStore());
}

export function rewindCursor(cursor: string): string {
  const ms = Date.parse(cursor);
  if (isNaN(ms)) return cursor;
  return new Date(ms - 1).toISOString();
}

const PULL_ENTITY_TYPES: readonly EntityType[] = [
  "book",
  "position",
  "highlight",
  "bookmark",
  "notebook",
  "chat_session",
  "chat_message",
  "settings",
] as const;

const EPOCH = new Date(0);

export interface ParsedPullCursors {
  cursorsByEntity: Record<EntityType, Date>;
  cursorTimestampsByEntity: Record<EntityType, string>;
  cursorIdsByEntity: Record<EntityType, string | null>;
  error?: string;
}

interface EncodedPullCursor {
  t: string;
  id: string;
}

export function encodePullCursor(timestamp: Date, id: string, exactTimestamp?: string): string {
  return JSON.stringify({
    t: exactTimestamp ?? timestamp.toISOString(),
    id,
  } satisfies EncodedPullCursor);
}

function parsePullCursor(cursor: string): {
  date: Date;
  timestamp: string;
  id: string | null;
  error?: string;
} {
  let timestamp = cursor;
  let id: string | null = null;

  if (cursor.trimStart().startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(cursor);
    } catch {
      return {
        date: EPOCH,
        timestamp: EPOCH.toISOString(),
        id: null,
        error: "Invalid encoded cursor",
      };
    }

    const encoded = parsed as Partial<EncodedPullCursor>;
    if (typeof encoded.t !== "string" || typeof encoded.id !== "string") {
      return {
        date: EPOCH,
        timestamp: EPOCH.toISOString(),
        id: null,
        error: "Invalid encoded cursor",
      };
    }
    timestamp = encoded.t;
    id = encoded.id;
  }

  const date = new Date(timestamp);
  if (isNaN(date.getTime())) {
    return {
      date: EPOCH,
      timestamp: EPOCH.toISOString(),
      id: null,
      error: "Invalid cursor timestamp",
    };
  }

  return { date, timestamp, id };
}

export function parseCursorsParam(cursorsParam: string | null): ParsedPullCursors {
  const cursorsByEntity = {} as Record<EntityType, Date>;
  const cursorTimestampsByEntity = {} as Record<EntityType, string>;
  const cursorIdsByEntity = {} as Record<EntityType, string | null>;
  for (const t of PULL_ENTITY_TYPES) {
    cursorsByEntity[t] = EPOCH;
    cursorTimestampsByEntity[t] = EPOCH.toISOString();
    cursorIdsByEntity[t] = null;
  }

  if (!cursorsParam) return { cursorsByEntity, cursorTimestampsByEntity, cursorIdsByEntity };

  let parsed: unknown;
  try {
    parsed = JSON.parse(cursorsParam);
  } catch {
    return {
      cursorsByEntity,
      cursorTimestampsByEntity,
      cursorIdsByEntity,
      error: "Invalid 'cursors' JSON",
    };
  }
  if (!Array.isArray(parsed)) {
    return {
      cursorsByEntity,
      cursorTimestampsByEntity,
      cursorIdsByEntity,
      error: "'cursors' must be a JSON array",
    };
  }

  for (const item of parsed) {
    if (!item || typeof item !== "object") {
      return {
        cursorsByEntity,
        cursorTimestampsByEntity,
        cursorIdsByEntity,
        error: "Invalid cursor entry",
      };
    }
    const { entityType, cursor } = item as Partial<SyncCursor>;
    if (typeof entityType !== "string" || !PULL_ENTITY_TYPES.includes(entityType as EntityType)) {
      return {
        cursorsByEntity,
        cursorTimestampsByEntity,
        cursorIdsByEntity,
        error: `Unknown entityType: ${String(entityType)}`,
      };
    }
    if (typeof cursor !== "string") {
      return {
        cursorsByEntity,
        cursorTimestampsByEntity,
        cursorIdsByEntity,
        error: `Missing cursor for ${entityType}`,
      };
    }
    const parsedCursor = parsePullCursor(cursor);
    if (parsedCursor.error) {
      return {
        cursorsByEntity,
        cursorTimestampsByEntity,
        cursorIdsByEntity,
        error: `${parsedCursor.error} for ${entityType}`,
      };
    }
    cursorsByEntity[entityType as EntityType] = parsedCursor.date;
    cursorTimestampsByEntity[entityType as EntityType] = parsedCursor.timestamp;
    cursorIdsByEntity[entityType as EntityType] = parsedCursor.id;
  }

  return { cursorsByEntity, cursorTimestampsByEntity, cursorIdsByEntity };
}
