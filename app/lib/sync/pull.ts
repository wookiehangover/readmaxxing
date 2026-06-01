import { ENTITY_MERGERS } from "./entity-mergers";
import { getCursor, rewindCursor, setCursor } from "./sync-cursors";
import { syncDebugLog } from "./sync-debug";
import type { EntityType, SyncCursor, SyncPullResponse } from "./types";

/** Entity types we actively sync (subset of all EntityType values). */
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

  // Send a per-entity cursor map so one entity's lag does not force the
  // others to re-scan. Wire format: `cursors` is a URL-encoded JSON array
  // of SyncCursor (see SyncPullRequest in types.ts). Entities without a
  // stored cursor are omitted; the server defaults them to epoch
  // ("pull from the beginning").
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

    syncDebugLog("pull-response", {
      groupCount: result.changes.length,
      recordCounts: result.changes.map((g) => ({ entity: g.entity, count: g.records.length })),
    });

    const entitiesWithMore: EntityType[] = [];

    for (const group of result.changes) {
      const merger = ENTITY_MERGERS[group.entity];
      if (!merger) continue;

      for (const record of group.records) {
        await merger(record as Record<string, unknown>);
      }

      // Opaque keyset cursors do not need timestamp overlap. Legacy ISO-only
      // cursors are still rewound so older server responses preserve the
      // existing duplicate-safe behavior.
      const persistedCursor = group.cursor.trimStart().startsWith("{")
        ? group.cursor
        : rewindCursor(group.cursor);
      await setCursor(group.entity, persistedCursor);
      cursorsByEntity.set(group.entity, group.cursor);

      if (group.hasMore) {
        entitiesWithMore.push(group.entity);
      }

      // Dispatch granular per-entity event so only relevant components re-render
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
