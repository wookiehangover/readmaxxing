import { ENTITY_MERGERS } from "./entity-mergers";
import { getCursor, rewindCursor, setCursor } from "./sync-cursors";
import { syncDebugLog } from "./sync-debug";
import type { EntityType, SyncCursor, SyncPullResponse } from "./types";

export const SYNCABLE_ENTITIES: EntityType[] = [
  "book",
  "position",
  "highlight",
  "bookmark",
  "notebook",
  "chat_session",
  "chat_message",
  "settings",
];

export interface PullContext {
  isStopped: () => boolean;
  onAuthExpired?: () => void;
}

export async function pullChanges(ctx: PullContext): Promise<void> {
  if (ctx.isStopped()) return;

  const cursorsByEntity = new Map<EntityType, string>();
  for (const entity of SYNCABLE_ENTITIES) {
    const cursor = await getCursor(entity);
    if (cursor) cursorsByEntity.set(entity, cursor);
  }

  let requestedEntities = [...SYNCABLE_ENTITIES];

  while (!ctx.isStopped() && requestedEntities.length > 0) {
    const cursors: SyncCursor[] = [];
    for (const entity of requestedEntities) {
      const cursor = cursorsByEntity.get(entity);
      if (cursor) cursors.push({ entityType: entity, cursor });
    }

    const params = new URLSearchParams();
    if (cursors.length > 0) {
      params.set("cursors", JSON.stringify(cursors));
    }
    params.set("entityType", requestedEntities.join(","));

    syncDebugLog("pull-start", { cursors, entities: requestedEntities });

    const res = await fetch(`/api/sync/pull?${params.toString()}`);

    if (res.status === 401) {
      ctx.onAuthExpired?.();
      return;
    }
    if (!res.ok) {
      throw new Error(`Pull failed: ${res.status} ${res.statusText}`);
    }

    const result: SyncPullResponse = await res.json();
    const chatSessionsHaveMore = result.changes.some(
      (group) => group.entity === "chat_session" && group.hasMore,
    );

    syncDebugLog("pull-response", {
      groupCount: result.changes.length,
      recordCounts: result.changes.map((g) => ({ entity: g.entity, count: g.records.length })),
    });

    const entitiesWithMore: EntityType[] = [];

    for (const group of result.changes) {
      const merger = ENTITY_MERGERS[group.entity];
      if (!merger) continue;

      if (group.entity === "chat_message" && chatSessionsHaveMore) {
        entitiesWithMore.push(group.entity);
        continue;
      }

      for (const record of group.records) {
        await merger(record as Record<string, unknown>);
      }

      const persistedCursor = group.cursor.trimStart().startsWith("{")
        ? group.cursor
        : rewindCursor(group.cursor);
      await setCursor(group.entity, persistedCursor);
      cursorsByEntity.set(group.entity, group.cursor);

      if (group.hasMore) {
        entitiesWithMore.push(group.entity);
      }

      if (group.records.length > 0) {
        queueMicrotask(() => {
          window.dispatchEvent(
            new CustomEvent("sync:entity-updated", { detail: { entity: group.entity } }),
          );
        });
      }
    }

    requestedEntities = entitiesWithMore;
  }
}
