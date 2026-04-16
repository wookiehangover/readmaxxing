/**
 * Pure merge functions for sync conflict resolution.
 *
 * Each function is stateless and deterministic — given the same inputs
 * they always produce the same output.
 */

// ---------------------------------------------------------------------------
// Last-Write-Wins merge
// ---------------------------------------------------------------------------

/**
 * Return whichever record has the higher `updatedAt` timestamp.
 * Ties are broken in favor of the remote record (server authority).
 */
export function lwwMerge<T extends { updatedAt: number }>(local: T, remote: T): T {
  return remote.updatedAt >= local.updatedAt ? remote : local;
}

// ---------------------------------------------------------------------------
// Set-union merge (for highlights)
// ---------------------------------------------------------------------------

interface Deletable {
  deletedAt?: number | null;
}

/**
 * Union two collections by ID. When the same ID exists in both:
 * - If either copy is non-deleted, prefer the non-deleted one.
 * - If both are deleted, prefer the one deleted most recently.
 * - If both are non-deleted, prefer the one with the later updatedAt (if present).
 */
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

    // Prefer non-deleted over deleted
    const existingDeleted = existing.deletedAt != null;
    const incomingDeleted = item.deletedAt != null;

    if (existingDeleted && !incomingDeleted) {
      merged.set(id, item);
    } else if (!existingDeleted && incomingDeleted) {
      // keep existing (non-deleted)
    } else if (existingDeleted && incomingDeleted) {
      // Both deleted — keep the one deleted most recently
      if ((item.deletedAt ?? 0) > (existing.deletedAt ?? 0)) {
        merged.set(id, item);
      }
    } else {
      // Both non-deleted — LWW fallback if updatedAt is available
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

// ---------------------------------------------------------------------------
// Append-only merge (for chat messages)
// ---------------------------------------------------------------------------

/**
 * Union two collections by ID, never removing any record.
 * If the same ID appears in both, the remote copy is preferred
 * (server is authoritative for content corrections).
 */
export function appendOnlyMerge<T>(local: T[], remote: T[], getId: (item: T) => string): T[] {
  const merged = new Map<string, T>();

  for (const item of local) {
    merged.set(getId(item), item);
  }

  for (const item of remote) {
    // Remote overwrites local for the same ID (server authority)
    merged.set(getId(item), item);
  }

  return Array.from(merged.values());
}
