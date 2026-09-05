import type { ChangeEntry } from "./types";

export interface BookIdRemap {
  fromId: string;
  toId: string;
}

export function remapBookmarkId(id: string, { fromId, toId }: BookIdRemap): string {
  const prefix = `bookmark:${fromId}:`;
  return id.startsWith(prefix) ? `bookmark:${toId}:${id.slice(prefix.length)}` : id;
}

/** Only protocol identity fields are references; user text/TipTap content is opaque. */
export function remapChange(change: ChangeEntry, remap: BookIdRemap): ChangeEntry {
  // Deleting a losing book acknowledges that alias only. Redirecting this to
  // the canonical book would turn cleanup into deletion of the shared copy.
  if (
    change.entity === "book" &&
    (change.operation === "delete" ||
      (change.data &&
        typeof change.data === "object" &&
        "deletedAt" in change.data &&
        change.data.deletedAt != null))
  )
    return change;
  const { fromId, toId } = remap;
  let entityId = change.entityId;
  if (["book", "notebook", "position"].includes(change.entity) && entityId === fromId) {
    entityId = toId;
  } else if (change.entity === "bookmark") {
    entityId = remapBookmarkId(entityId, remap);
  }
  let data = change.data;
  if (data && typeof data === "object" && !Array.isArray(data) && change.entity !== "settings") {
    const record = data as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    if (record.bookId === fromId) updates.bookId = toId;
    if (["book", "notebook", "position"].includes(change.entity) && record.id === fromId) {
      updates.id = toId;
    } else if (change.entity === "bookmark" && typeof record.id === "string") {
      const id = remapBookmarkId(record.id, remap);
      if (id !== record.id) updates.id = id;
    }
    if (Object.keys(updates).length) data = { ...record, ...updates };
  }
  return entityId === change.entityId && data === change.data
    ? change
    : { ...change, entityId, data };
}

/** Failure bookkeeping can change while a request is in flight; its sent snapshot cannot. */
export function sameChangeSnapshot(a: ChangeEntry, b: ChangeEntry): boolean {
  return (
    a.id === b.id &&
    a.entity === b.entity &&
    a.entityId === b.entityId &&
    a.operation === b.operation &&
    a.timestamp === b.timestamp &&
    (a.revision ?? 0) === (b.revision ?? 0) &&
    a.ownerId === b.ownerId &&
    JSON.stringify(a.data) === JSON.stringify(b.data)
  );
}
