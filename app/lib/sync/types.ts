export type EntityType =
  | "book"
  | "highlight"
  | "bookmark"
  | "notebook"
  | "chat_session"
  | "chat_message"
  | "position"
  | "settings";

export interface ChangeEntry {
  id: string;
  entity: EntityType;
  entityId: string;
  operation: "put" | "delete";
  data: unknown;
  timestamp: number;
  synced: boolean;
}

export interface SyncPushRequest {
  changes: ChangeEntry[];
}

export interface SyncPushResponse {
  accepted: Array<{
    id: string;
    canonicalId?: string;
  }>;
  rejected: Array<{
    id: string;
    reason: string;
  }>;
  serverTimestamp: string;
}

export interface SyncPullRequest {
  cursors: SyncCursor[];
  limit?: number;
}

export interface SyncPullResponse {
  changes: Array<{
    entity: EntityType;
    records: unknown[];
    cursor: string;
    hasMore: boolean;
  }>;
  serverTimestamp: string;
}

export interface SyncCursor {
  entityType: EntityType;
  cursor: string;
}

export type MergeStrategy = "lww" | "set_union" | "append_only";

export const ENTITY_MERGE_STRATEGIES: Record<EntityType, MergeStrategy> = {
  book: "lww",
  highlight: "set_union",
  bookmark: "set_union",
  notebook: "lww",
  chat_session: "lww",
  chat_message: "append_only",
  position: "lww",
  settings: "lww",
} as const;
