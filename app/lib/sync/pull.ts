import { ENTITY_MERGERS } from "./entity-mergers";
import { getCursor, rewindCursor, setCursor } from "./sync-cursors";
import { syncDebugLog } from "./sync-debug";
import type { EntityType, SyncCursor, SyncPullResponse } from "./types";

/** Entity types we actively sync (subset of all EntityType values). */
export const SYNCABLE_ENTITIES: EntityType[] = [
  "book",
  "position",
  "highlight",
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
  const cursors: SyncCursor[] = [];
  for (const entity of SYNCABLE_ENTITIES) {
    const cursor = await getCursor(entity);
    if (cursor) cursors.push({ entityType: entity, cursor });
  }

  const params = new URLSearchParams();
  if (cursors.length > 0) {
    params.set("cursors", JSON.stringify(cursors));
  }
  params.set("entityType", SYNCABLE_ENTITIES.join(","));

  syncDebugLog("pull-start", { cursors });

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

  for (const group of result.changes) {
    const merger = ENTITY_MERGERS[group.entity];
    if (!merger) continue;

    for (const record of group.records) {
      await merger(record as Record<string, unknown>);
    }

    // Rewind the server cursor by 1ms before persisting. The server uses
    // strict `>` when filtering by `since`, so advancing to the exact
    // `updatedAt` of the last row would skip any sibling row that shares
    // the same millisecond (common on burst writes). Idempotent mergers
    // make the 1ms overlap safe.
    await setCursor(group.entity, rewindCursor(group.cursor));

    // Dispatch granular per-entity event so only relevant components re-render
    if (group.records.length > 0) {
      queueMicrotask(() => {
        window.dispatchEvent(
          new CustomEvent("sync:entity-updated", { detail: { entity: group.entity } }),
        );
      });
    }
  }
}
