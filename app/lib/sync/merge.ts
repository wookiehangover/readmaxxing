export function lwwMerge<T extends { updatedAt: number }>(local: T, remote: T): T {
  return remote.updatedAt >= local.updatedAt ? remote : local;
}

interface Deletable {
  deletedAt?: number | null;
}

export function setUnionMerge<T extends Deletable>(
  local: T[],
  remote: T[],
  getId: (item: T) => string,
): T[] {
  const merged = new Map<string, T>();

  for (const item of local) {
    merged.set(getId(item), item);
  }

  for (const item of remote) {
    const id = getId(item);
    const existing = merged.get(id);
    if (!existing) {
      merged.set(id, item);
      continue;
    }

    const existingDeleted = existing.deletedAt != null;
    const incomingDeleted = item.deletedAt != null;

    if (existingDeleted && !incomingDeleted) {
    } else if (!existingDeleted && incomingDeleted) {
      merged.set(id, item);
    } else if (existingDeleted && incomingDeleted) {
      if ((item.deletedAt ?? 0) > (existing.deletedAt ?? 0)) {
        merged.set(id, item);
      }
    } else {
      const existingUpdated = (existing as Record<string, unknown>).updatedAt;
      const incomingUpdated = (item as Record<string, unknown>).updatedAt;
      if (
        typeof existingUpdated === "number" &&
        typeof incomingUpdated === "number" &&
        incomingUpdated > existingUpdated
      ) {
        merged.set(id, item);
      }
    }
  }

  return Array.from(merged.values());
}

export function appendOnlyMerge<T>(local: T[], remote: T[], getId: (item: T) => string): T[] {
  const merged = new Map<string, T>();

  for (const item of local) {
    merged.set(getId(item), item);
  }

  for (const item of remote) {
    merged.set(getId(item), item);
  }

  return Array.from(merged.values());
}
