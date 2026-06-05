const activeReaders = new Set<string>();

export function registerActiveReader(bookId: string): void {
  activeReaders.add(bookId);
}

export function unregisterActiveReader(bookId: string): void {
  activeReaders.delete(bookId);
}

export function isActiveReader(bookId: string): boolean {
  return activeReaders.has(bookId);
}
