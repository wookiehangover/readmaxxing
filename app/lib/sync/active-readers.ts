const activeReaders = new Set<string>();
const pendingPositionRecords = new Map<string, Record<string, unknown>>();

export function registerActiveReader(bookId: string): void {
  activeReaders.add(bookId);
}

export function unregisterActiveReader(bookId: string): void {
  activeReaders.delete(bookId);
  pendingPositionRecords.delete(bookId);
}

export function isActiveReader(bookId: string): boolean {
  return activeReaders.has(bookId);
}

export function deferPositionMerge(bookId: string, remoteRecord: Record<string, unknown>): void {
  pendingPositionRecords.set(bookId, remoteRecord);
}
