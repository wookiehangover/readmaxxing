// Pure transforms that convert server-side row shapes into the local IDB
// record shapes used by the client stores. No side effects, no I/O — these
// functions are safe to call from any context (including tests).

/** ChatSession shape matching chat-store.ts */
export interface LocalChatSession {
  id: string;
  bookId: string;
  title: string;
  messages: LocalChatMessage[];
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface LocalChatMessage {
  id: string;
  role: string;
  content: string;
  createdAt: number;
  parts?: unknown[];
}

export function toTimestamp(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" || value instanceof Date) {
    const ms = new Date(value as string).getTime();
    if (!isNaN(ms)) return ms;
  }
  return Date.now();
}

export function toOptionalTimestamp(value: unknown): number | undefined {
  if (value == null) return undefined;
  return toTimestamp(value);
}

/**
 * Transform a server BookRow into the local BookMeta shape expected by
 * BookMetaSchema (see book-store.ts).
 */
export function serverBookToLocal(record: Record<string, unknown>): Record<string, unknown> {
  return {
    id: record.id,
    title: (record.title as string) ?? "",
    author: (record.author as string) ?? "",
    coverImage: null, // can't reconstruct Blob from server; null until re-downloaded
    format: (record.format as string) ?? "epub",
    remoteCoverUrl: (record.coverBlobUrl as string) ?? undefined,
    remoteFileUrl: (record.fileBlobUrl as string) ?? undefined,
    fileHash: (record.fileHash as string) ?? undefined,
    updatedAt: toTimestamp(record.updatedAt),
    deletedAt: toOptionalTimestamp(record.deletedAt),
  };
}

/**
 * Transform a server ReadingPositionRow into the local PositionRecord shape
 * expected by position-store.ts ({ cfi, updatedAt: number }).
 */
export function serverPositionToLocal(record: Record<string, unknown>): {
  id: string;
  cfi: string;
  updatedAt: number;
} {
  const bookId = (record.bookId as string) ?? (record.id as string);
  return {
    id: bookId,
    cfi: (record.cfi as string) ?? "",
    updatedAt: toTimestamp(record.updatedAt),
  };
}

/**
 * Transform a server HighlightRow into the local Highlight shape
 * expected by annotations-store.ts.
 */
export function serverHighlightToLocal(record: Record<string, unknown>): Record<string, unknown> {
  return {
    id: record.id,
    bookId: record.bookId,
    cfiRange: (record.cfiRange as string) ?? "",
    text: (record.text as string) ?? "",
    color: (record.color as string) ?? "yellow",
    createdAt: toTimestamp(record.createdAt),
    updatedAt: toTimestamp(record.updatedAt ?? record.createdAt),
    pageNumber: (record.pageNumber as number) ?? undefined,
    textOffset: (record.textOffset as number) ?? undefined,
    textLength: (record.textLength as number) ?? undefined,
    textAnchor: (record.textAnchor as Record<string, unknown>) ?? undefined,
    note: (record.note as string) ?? undefined,
    deletedAt: toOptionalTimestamp(record.deletedAt),
  };
}

/**
 * Transform a server NotebookRow into the local Notebook shape
 * expected by annotations-store.ts.
 */
export function serverNotebookToLocal(record: Record<string, unknown>): Record<string, unknown> {
  return {
    bookId: (record.bookId as string) ?? "",
    content: record.content ?? {},
    updatedAt: toTimestamp(record.updatedAt),
  };
}

/**
 * Transform a server ChatSessionRow into a minimal local ChatSession shape.
 * Messages are merged separately — the session transform only handles metadata.
 */
export function serverChatSessionToLocal(record: Record<string, unknown>): LocalChatSession {
  return {
    id: (record.id as string) ?? "",
    bookId: (record.bookId as string) ?? "",
    title: (record.title as string) ?? "",
    messages: [], // messages merged separately
    createdAt: toTimestamp(record.createdAt),
    updatedAt: toTimestamp(record.updatedAt),
    deletedAt: toOptionalTimestamp(record.deletedAt),
  };
}

/**
 * Transform a server ChatMessageRow into a local ChatMessage shape.
 */
export function serverChatMessageToLocal(record: Record<string, unknown>): LocalChatMessage {
  return {
    id: (record.id as string) ?? "",
    role: (record.role as string) ?? "user",
    content: (record.content as string) ?? "",
    createdAt: toTimestamp(record.createdAt),
    parts: record.parts != null ? (record.parts as unknown[]) : undefined,
  };
}
