const activeReaders = new Set<string>();
const pendingPositionRecords = new Map<string, Record<string, unknown>>();

export function registerActiveReader(bookId: string): void {
  activeReaders.add(bookId);
}

export function unregisterActiveReader(bookId: string): void {
  activeReaders.delete(bookId);
  const pending = pendingPositionRecords.get(bookId);
  if (pending === undefined) return;
  pendingPositionRecords.delete(bookId);
  // Dynamic import avoids the circular dependency with entity-mergers,
  // which imports isActiveReader from this module.
  import("./entity-mergers")
    .then(({ mergePositionRecord }) => mergePositionRecord(pending))
    .catch((err) => {
      console.error("Failed to apply deferred position merge:", err);
    });
}

export function isActiveReader(bookId: string): boolean {
  return activeReaders.has(bookId);
}

export function deferPositionMerge(bookId: string, remoteRecord: Record<string, unknown>): void {
  pendingPositionRecords.set(bookId, remoteRecord);
}

export function getPendingPositionMerge(bookId: string): Record<string, unknown> | undefined {
  const pending = pendingPositionRecords.get(bookId);
  if (pending !== undefined) pendingPositionRecords.delete(bookId);
  return pending;
}
