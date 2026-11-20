export function isWellFormedEntry(entry: unknown): entry is [IDBValidKey, unknown] {
  return Array.isArray(entry) && entry.length >= 2;
}
