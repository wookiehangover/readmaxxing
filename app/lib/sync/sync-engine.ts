import { upload } from "@vercel/blob/client";
import { createStore, get, set, entries } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import { getUnsyncedChanges, markSynced, clearSyncedChanges, recordChange } from "./change-log";
import { lwwMerge, setUnionMerge } from "./merge";
import { remapBookId } from "./remap";
import { syncDebugLog } from "./sync-debug";
import { getCursor, setCursor } from "./sync-cursors";
import type { EntityType, SyncPushRequest, SyncPushResponse, SyncPullResponse } from "./types";
import {
  clearUploadRetry,
  recordUploadFailure,
  runUploadWithRetry,
  shouldAttemptUpload,
  uploadRetryKey,
  type UploadRetryEntry,
} from "./upload-retry";

// ---------------------------------------------------------------------------
// IDB store accessors (same db/store names as book-store & position-store,
// accessed directly to avoid circular Effect service dependencies)
// ---------------------------------------------------------------------------

let _bookStore: ReturnType<typeof createStore> | null = null;
let _bookDataStore: ReturnType<typeof createStore> | null = null;
let _positionStore: ReturnType<typeof createStore> | null = null;
let _highlightStore: ReturnType<typeof createStore> | null = null;
let _notebookStore: ReturnType<typeof createStore> | null = null;
let _chatSessionStore: ReturnType<typeof createStore> | null = null;

function getBookStore(): UseStore {
  if (!_bookStore) _bookStore = createStore("ebook-reader-db", "books");
  return _bookStore;
}

function getBookDataStore(): UseStore {
  if (!_bookDataStore) _bookDataStore = createStore("ebook-reader-book-data", "book-data");
  return _bookDataStore;
}

function getPositionStore(): UseStore {
  if (!_positionStore) _positionStore = createStore("ebook-reader-positions", "positions");
  return _positionStore;
}

function getHighlightStore(): UseStore {
  if (!_highlightStore) _highlightStore = createStore("ebook-reader-highlights", "highlights");
  return _highlightStore;
}

function getNotebookStore(): UseStore {
  if (!_notebookStore) _notebookStore = createStore("ebook-reader-notebooks", "notebooks");
  return _notebookStore;
}

function getChatSessionStore(): UseStore {
  if (!_chatSessionStore) _chatSessionStore = createStore("ebook-reader-chat-sessions", "sessions");
  return _chatSessionStore;
}

// ---------------------------------------------------------------------------
// SyncEngine interface
// ---------------------------------------------------------------------------

export interface SyncEngine {
  /** Push all unsynced local changes to the server. */
  pushChanges(): Promise<void>;
  /** Pull remote changes for all entity types and merge into local IDB. */
  pullChanges(): Promise<void>;
  /** Start periodic push/pull intervals and do an immediate pull. */
  startSync(): void;
  /** Stop all periodic sync intervals. */
  stopSync(): void;
  /** Trigger an immediate push (e.g. after a local write). */
  triggerPush(): void;
  /** Trigger an immediate pull (e.g. on window focus). */
  triggerPull(): void;
  /**
   * Re-download the book file and cover from the server, overwriting local
   * copies. If the book is missing a remote URL, upload the local file /
   * cover to blob storage instead so the DB row gets populated.
   */
  reloadBookFiles(bookId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Entity types we actively sync (subset of all EntityType values)
// ---------------------------------------------------------------------------

const SYNCABLE_ENTITIES: EntityType[] = [
  "book",
  "position",
  "highlight",
  "notebook",
  "chat_session",
  "chat_message",
  "settings",
];

// ---------------------------------------------------------------------------
// Server → local record transforms
// ---------------------------------------------------------------------------

function toTimestamp(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" || value instanceof Date) {
    const ms = new Date(value as string).getTime();
    if (!isNaN(ms)) return ms;
  }
  return Date.now();
}

function toOptionalTimestamp(value: unknown): number | undefined {
  if (value == null) return undefined;
  return toTimestamp(value);
}

/**
 * Transform a server BookRow into the local BookMeta shape expected by
 * BookMetaSchema (see book-store.ts).
 */
function serverBookToLocal(record: Record<string, unknown>): Record<string, unknown> {
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
function serverPositionToLocal(record: Record<string, unknown>): {
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
function serverHighlightToLocal(record: Record<string, unknown>): Record<string, unknown> {
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
function serverNotebookToLocal(record: Record<string, unknown>): Record<string, unknown> {
  return {
    bookId: (record.bookId as string) ?? "",
    content: record.content ?? {},
    updatedAt: toTimestamp(record.updatedAt),
  };
}

/** ChatSession shape matching chat-store.ts */
interface LocalChatSession {
  id: string;
  bookId: string;
  title: string;
  messages: LocalChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface LocalChatMessage {
  id: string;
  role: string;
  content: string;
  createdAt: number;
  parts?: unknown[];
}

/**
 * Transform a server ChatSessionRow into a minimal local ChatSession shape.
 * Messages are merged separately — the session transform only handles metadata.
 */
function serverChatSessionToLocal(record: Record<string, unknown>): LocalChatSession {
  return {
    id: (record.id as string) ?? "",
    bookId: (record.bookId as string) ?? "",
    title: (record.title as string) ?? "",
    messages: [], // messages merged separately
    createdAt: toTimestamp(record.createdAt),
    updatedAt: toTimestamp(record.updatedAt),
  };
}

/**
 * Transform a server ChatMessageRow into a local ChatMessage shape.
 */
function serverChatMessageToLocal(record: Record<string, unknown>): LocalChatMessage {
  return {
    id: (record.id as string) ?? "",
    role: (record.role as string) ?? "user",
    content: (record.content as string) ?? "",
    createdAt: toTimestamp(record.createdAt),
    parts: record.parts != null ? (record.parts as unknown[]) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

export async function mergeBookRecord(record: Record<string, unknown>): Promise<void> {
  const store = getBookStore();
  const remoteRecord = serverBookToLocal(record);
  const id = remoteRecord.id as string;
  const remoteHash = remoteRecord.fileHash as string | undefined;
  const remoteDeletedAt = remoteRecord.deletedAt as number | undefined;

  // Cross-device dedup on pull: if the incoming non-deleted book matches
  // an existing local book by fileHash under a different id, remap local
  // references to the incoming canonical id before applying the merge so
  // the UI does not show a duplicate entry until the next push/pull.
  if (!remoteDeletedAt && remoteHash) {
    const allBooks = await entries<string, Record<string, unknown>>(store);
    for (const [localId, localBook] of allBooks) {
      if (!localBook || localId === id) continue;
      if (localBook.deletedAt != null) continue;
      if (localBook.fileHash !== remoteHash) continue;
      await remapBookId(localId, id);
      if (typeof window !== "undefined") {
        queueMicrotask(() => {
          for (const entity of [
            "book",
            "position",
            "highlight",
            "notebook",
            "chat_session",
          ] as const) {
            window.dispatchEvent(new CustomEvent("sync:entity-updated", { detail: { entity } }));
          }
        });
      }
      break;
    }
  }

  const local = await get<Record<string, unknown>>(id, store);

  if (!local) {
    await set(id, remoteRecord, store);
    return;
  }

  const merged = lwwMerge(local as { updatedAt: number }, remoteRecord as { updatedAt: number });
  if (merged === remoteRecord) {
    // Server wins — preserve client-only fields from local record.
    // hasLocalFile and coverImage are never sent to the server, so
    // serverBookToLocal always returns them as undefined/null.
    //
    // remoteCoverUrl / remoteFileUrl: treat nullish server values as
    // "no opinion" and keep the locally-known URL. The server row may
    // have been stamped before this device's upload push landed, or a
    // different device created the book row without uploading blobs
    // yet. Overwriting with undefined would clear URLs we already have
    // and force a redundant re-upload on the next push.
    await set(
      id,
      {
        ...remoteRecord,
        hasLocalFile: local.hasLocalFile,
        coverImage: local.coverImage ?? remoteRecord.coverImage,
        remoteCoverUrl: remoteRecord.remoteCoverUrl ?? local.remoteCoverUrl,
        remoteFileUrl: remoteRecord.remoteFileUrl ?? local.remoteFileUrl,
      },
      store,
    );
  }
}

async function mergePositionRecord(record: Record<string, unknown>): Promise<void> {
  const store = getPositionStore();
  const localRecord = serverPositionToLocal(record);
  const id = localRecord.id;
  const local = await get<Record<string, unknown>>(id, store);

  if (!local) {
    await set(id, localRecord, store);
    return;
  }

  const merged = lwwMerge(local as { updatedAt: number }, localRecord as { updatedAt: number });
  if (merged === localRecord) {
    await set(id, localRecord, store);
  }
}

/**
 * Merge a single highlight record using set-union semantics.
 * If either side has deletedAt, tombstone propagates. Otherwise LWW by updatedAt.
 */
async function mergeHighlightRecord(record: Record<string, unknown>): Promise<void> {
  const store = getHighlightStore();
  const remoteRecord = serverHighlightToLocal(record);
  const id = remoteRecord.id as string;
  const local = await get<Record<string, unknown>>(id, store);

  if (!local) {
    await set(id, remoteRecord, store);
    return;
  }

  // Use setUnionMerge for a single-item merge (handles tombstones correctly)
  const [merged] = setUnionMerge(
    [local as { deletedAt?: number | null }],
    [remoteRecord as { deletedAt?: number | null }],
    (item) => (item as Record<string, unknown>).id as string,
  );
  // Write if the merge result differs from local
  if (merged !== local) {
    await set(id, merged, store);
  }
}

/**
 * Merge a notebook record using LWW by updatedAt.
 */
async function mergeNotebookRecord(record: Record<string, unknown>): Promise<void> {
  const store = getNotebookStore();
  const remoteRecord = serverNotebookToLocal(record);
  const id = remoteRecord.bookId as string;
  const local = await get<Record<string, unknown>>(id, store);

  if (!local) {
    await set(id, remoteRecord, store);
    return;
  }

  const merged = lwwMerge(local as { updatedAt: number }, remoteRecord as { updatedAt: number });
  if (merged === remoteRecord) {
    await set(id, remoteRecord, store);
  }
}

/**
 * Merge a chat session record (LWW for session metadata).
 * Chat sessions are stored per-bookId as ChatSession[] in IDB.
 */
async function mergeChatSessionRecord(record: Record<string, unknown>): Promise<void> {
  const store = getChatSessionStore();
  const remote = serverChatSessionToLocal(record);
  const bookId = remote.bookId;
  if (!bookId) return;

  const sessions = (await get<LocalChatSession[]>(bookId, store)) ?? [];
  const idx = sessions.findIndex((s) => s.id === remote.id);

  if (idx < 0) {
    // New session from server — add it (preserve empty messages array)
    sessions.push(remote);
  } else {
    // LWW merge on metadata only, preserving local messages
    const local = sessions[idx];
    if (remote.updatedAt > local.updatedAt) {
      sessions[idx] = {
        ...remote,
        messages: local.messages, // keep local messages intact
      };
    }
  }

  await set(bookId, sessions, store);
}

/**
 * Merge a chat message record (append-only by message ID).
 * Finds the parent session in IDB and adds the message if not already present.
 */
async function mergeChatMessageRecord(record: Record<string, unknown>): Promise<void> {
  const store = getChatSessionStore();
  const remoteMsg = serverChatMessageToLocal(record);
  const sessionId = (record.sessionId as string) ?? "";
  if (!sessionId) return;

  // We need to find which bookId this session belongs to.
  // Scan all entries to find the session. This is suboptimal but the chat
  // store is keyed by bookId (not sessionId).
  const allEntries = await entries<string, LocalChatSession[]>(store);
  for (const entry of allEntries) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const bookId = entry[0];
    const sessions = entry[1];
    if (!Array.isArray(sessions)) continue;
    const sIdx = sessions.findIndex((s) => s && s.id === sessionId);
    if (sIdx < 0) continue;

    const session = sessions[sIdx];
    // Append-only: add if not already present by ID.
    // Messages arrive from the server in created_at ASC order, so simply
    // appending preserves the correct sequence without needing a sort
    // (sorting was unreliable because some messages had createdAt of 0).
    const exists = session.messages.some((m) => m.id === remoteMsg.id);
    if (!exists) {
      session.messages.push(remoteMsg);
      sessions[sIdx] = { ...session, updatedAt: Math.max(session.updatedAt, remoteMsg.createdAt) };
      await set(bookId, sessions, store);
    }
    return;
  }

  // If the session doesn't exist locally yet, the session record may arrive
  // in the same pull batch. The pull loop processes entities in order
  // (chat_session before chat_message), so this is unlikely but harmless.
}

/**
 * Merge a settings record (LWW).
 * Settings live in localStorage, not IDB. After merging, dispatch a custom
 * event so useSettings re-reads.
 */
async function mergeSettingsRecord(record: Record<string, unknown>): Promise<void> {
  const remoteSettings = record.settings as Record<string, unknown> | undefined;
  const remoteUpdatedAt = toTimestamp(record.updatedAt);
  if (!remoteSettings) return;

  const STORAGE_KEY = "app-settings";
  let local: Record<string, unknown> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) local = JSON.parse(raw);
  } catch {
    // corrupt localStorage, overwrite
  }

  const localUpdatedAt = typeof local.updatedAt === "number" ? local.updatedAt : 0;

  if (remoteUpdatedAt > localUpdatedAt) {
    const merged = { ...remoteSettings, updatedAt: remoteUpdatedAt };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    queueMicrotask(() => {
      window.dispatchEvent(new CustomEvent("settings-changed"));
    });
  }
}

const ENTITY_MERGERS: Partial<
  Record<EntityType, (record: Record<string, unknown>) => Promise<void>>
> = {
  book: mergeBookRecord,
  position: mergePositionRecord,
  highlight: mergeHighlightRecord,
  notebook: mergeNotebookRecord,
  chat_session: mergeChatSessionRecord,
  chat_message: mergeChatMessageRecord,
  settings: mergeSettingsRecord,
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface SyncEngineConfig {
  /** Authenticated user ID. Required for file uploads (used in the blob pathname). */
  userId: string;
  onSyncStart?: () => void;
  onSyncEnd?: (result: { success: boolean }) => void;
  onSyncError?: (error: Error) => void;
  onAuthExpired?: () => void;
}

const PUSH_INTERVAL_MS = 30_000;
const PULL_INTERVAL_MS = 60_000;

export function makeSyncEngine(config: SyncEngineConfig): SyncEngine {
  let pushTimer: ReturnType<typeof setInterval> | null = null;
  let pullTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  // Per-book upload retry state. In-memory only: resets on reload / new engine
  // instance. Prevents the sync loop from hammering the blob endpoint when a
  // particular book's upload keeps failing (e.g. Vercel Blob returning 503).
  const uploadRetryState = new Map<string, UploadRetryEntry>();

  /**
   * Wrapper around {@link uploadFile} that enforces the per-book exponential
   * backoff. On success the retry state for this book+type is cleared; on
   * failure (null return) the next-attempt timestamp is pushed forward along
   * the {@link UPLOAD_BACKOFF_SCHEDULE_MS} schedule.
   */
  async function uploadFileWithBackoff(
    bookId: string,
    data: ArrayBuffer | Blob,
    type: "file" | "cover",
  ): Promise<string | null> {
    const key = uploadRetryKey(bookId, type);
    const decision = shouldAttemptUpload(uploadRetryState, key, Date.now());
    if (!decision.attempt) {
      syncDebugLog("upload-skipped", {
        bookId,
        type,
        retryInMs: decision.retryInMs,
      });
      return null;
    }
    const size = data instanceof Blob ? data.size : data.byteLength;
    syncDebugLog("upload-attempt", { bookId, type, size });
    const url = await uploadFile(bookId, data, type);
    if (url) {
      clearUploadRetry(uploadRetryState, key);
      syncDebugLog("upload-success", { bookId, type, size });
    } else {
      recordUploadFailure(uploadRetryState, key, Date.now());
      syncDebugLog("upload-failed", { bookId, type, size });
    }
    return url;
  }

  async function uploadFile(
    bookId: string,
    data: ArrayBuffer | Blob,
    type: "file" | "cover",
  ): Promise<string | null> {
    const folder = type === "cover" ? "covers" : "books";
    const fileName = type === "cover" ? "cover.jpg" : "book.epub";
    const contentType = type === "cover" ? "image/jpeg" : "application/epub+zip";
    const blob = data instanceof Blob ? data : new Blob([data], { type: contentType });
    const pathname = `${folder}/${config.userId}/${bookId}/${fileName}`;

    const result = await runUploadWithRetry(
      () =>
        upload(pathname, blob, {
          access: "private",
          handleUploadUrl: "/api/sync/files/upload",
          clientPayload: JSON.stringify({ bookId, type }),
          contentType,
        }),
      {
        onAuthExpired: () => config.onAuthExpired?.(),
        onTransientRetry: (attempt, delayMs, err) => {
          console.warn(
            `[sync] File upload transient error for ${bookId} (${type}), attempt ${attempt}, retrying in ${delayMs}ms:`,
            err,
          );
        },
        onGiveUp: (err, totalAttempts) => {
          console.error(
            `[sync] File upload giving up for ${bookId} (${type}) after ${totalAttempts} transient failures:`,
            err,
          );
        },
        onPermanentFailure: (err) => {
          console.error(`[sync] File upload failed for ${bookId} (${type}):`, err);
        },
      },
    );

    return result?.url ?? null;
  }

  /**
   * Scan all books in IDB and upload any that have local file data or cover
   * images but are missing their remote URLs. Runs asynchronously after
   * metadata push — failures are logged but don't block the sync cycle.
   */
  async function uploadPendingFiles(): Promise<void> {
    if (stopped) return;
    // Safety: never attempt uploads before userId is known.
    if (!config.userId) return;

    const bookStore = getBookStore();
    const dataStore = getBookDataStore();
    const allBooks = await entries<string, Record<string, unknown>>(bookStore);

    syncDebugLog("upload-pending-start", { bookCount: allBooks.length });

    for (const entry of allBooks) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const bookId = entry[0];
      const meta = entry[1];
      if (!meta || typeof meta !== "object" || meta.deletedAt) continue;

      // Upload epub file if missing remoteFileUrl
      if (!meta.remoteFileUrl) {
        const fileData = await get<ArrayBuffer>(bookId, dataStore);
        if (fileData) {
          const url = await uploadFileWithBackoff(bookId, fileData, "file");
          if (url) {
            const stamped = {
              ...meta,
              remoteFileUrl: url,
              hasLocalFile: true,
              updatedAt: Date.now(),
            };
            await set(bookId, stamped, bookStore);
            // Enqueue a book change so the URL is carried to the server on
            // the next push. The onUploadCompleted webhook also writes it,
            // but is unreliable; this is the authoritative persistence path.
            recordChange({
              entity: "book",
              entityId: bookId,
              operation: "put",
              data: stamped,
              timestamp: stamped.updatedAt,
            }).catch(console.error);
          }
        }
      }

      // Upload cover image if missing remoteCoverUrl
      if (!meta.remoteCoverUrl && meta.coverImage instanceof Blob) {
        const url = await uploadFileWithBackoff(bookId, meta.coverImage, "cover");
        if (url) {
          // Re-read in case the file upload above already updated meta
          const current = (await get<Record<string, unknown>>(bookId, bookStore)) ?? meta;
          const stamped = {
            ...current,
            remoteCoverUrl: url,
            hasLocalFile: true,
            updatedAt: Date.now(),
          };
          await set(bookId, stamped, bookStore);
          recordChange({
            entity: "book",
            entityId: bookId,
            operation: "put",
            data: stamped,
            timestamp: stamped.updatedAt,
          }).catch(console.error);
        }
      }
    }

    // Notify UI so book list re-renders without stale cloud icons
    if (typeof window !== "undefined") {
      queueMicrotask(() => {
        window.dispatchEvent(
          new CustomEvent("sync:entity-updated", { detail: { entity: "book" } }),
        );
      });
    }
  }

  /**
   * Re-download file + cover for a single book from the server, overwriting
   * the locally cached copies. If the book is missing `remoteFileUrl` or
   * `remoteCoverUrl`, upload the local file / cover to blob storage so the
   * DB row gets populated (same logic as {@link uploadPendingFiles}, but
   * scoped to one book).
   */
  async function reloadBookFiles(bookId: string): Promise<void> {
    if (!config.userId) return;

    const bookStore = getBookStore();
    const dataStore = getBookDataStore();

    const rawMeta = await get<Record<string, unknown>>(bookId, bookStore);
    if (!rawMeta || typeof rawMeta !== "object" || rawMeta.deletedAt) return;

    syncDebugLog("reload-start", { bookId });

    let meta: Record<string, unknown> = { ...rawMeta };
    let metaChanged = false;

    // --- File ---
    if (meta.remoteFileUrl) {
      try {
        const res = await fetch(
          `/api/sync/files/download?bookId=${encodeURIComponent(bookId)}&type=file`,
          { credentials: "include" },
        );
        if (res.ok) {
          const buf = await res.arrayBuffer();
          await set(bookId, buf, dataStore);
          if (!meta.hasLocalFile) {
            meta = { ...meta, hasLocalFile: true };
            metaChanged = true;
          }
        } else {
          console.error(`[sync] reload file download failed: ${res.status} ${res.statusText}`);
        }
      } catch (err) {
        console.error("[sync] reload file download failed:", err);
      }
    } else {
      const fileData = await get<ArrayBuffer>(bookId, dataStore);
      if (fileData) {
        const url = await uploadFileWithBackoff(bookId, fileData, "file");
        if (url) {
          meta = {
            ...meta,
            remoteFileUrl: url,
            hasLocalFile: true,
            updatedAt: Date.now(),
          };
          metaChanged = true;
          recordChange({
            entity: "book",
            entityId: bookId,
            operation: "put",
            data: meta,
            timestamp: meta.updatedAt as number,
          }).catch(console.error);
        }
      }
    }

    // --- Cover ---
    if (meta.remoteCoverUrl) {
      try {
        const res = await fetch(
          `/api/sync/files/download?bookId=${encodeURIComponent(bookId)}&type=cover`,
          { credentials: "include" },
        );
        if (res.ok) {
          const blob = await res.blob();
          meta = { ...meta, coverImage: blob };
          metaChanged = true;
        } else {
          console.error(`[sync] reload cover download failed: ${res.status} ${res.statusText}`);
        }
      } catch (err) {
        console.error("[sync] reload cover download failed:", err);
      }
    } else if (meta.coverImage instanceof Blob) {
      const url = await uploadFileWithBackoff(bookId, meta.coverImage, "cover");
      if (url) {
        meta = {
          ...meta,
          remoteCoverUrl: url,
          updatedAt: Date.now(),
        };
        metaChanged = true;
        recordChange({
          entity: "book",
          entityId: bookId,
          operation: "put",
          data: meta,
          timestamp: meta.updatedAt as number,
        }).catch(console.error);
      }
    }

    if (metaChanged) {
      await set(bookId, meta, bookStore);
    }

    syncDebugLog("reload-end", { bookId, metaChanged });

    if (typeof window !== "undefined") {
      queueMicrotask(() => {
        window.dispatchEvent(
          new CustomEvent("sync:entity-updated", { detail: { entity: "book" } }),
        );
      });
    }
  }

  async function pushChanges(): Promise<void> {
    if (stopped) return;
    const changes = await getUnsyncedChanges();
    if (changes.length === 0) return;

    syncDebugLog("push-start", { changeCount: changes.length });

    const body: SyncPushRequest = { changes };
    const res = await fetch("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.status === 401) {
      config.onAuthExpired?.();
      return;
    }
    if (!res.ok) {
      throw new Error(`Push failed: ${res.status} ${res.statusText}`);
    }

    const result: SyncPushResponse = await res.json();
    syncDebugLog("push-response", {
      accepted: result.accepted.length,
      rejected: result.rejected?.length ?? 0,
    });
    if (result.accepted.length > 0) {
      await markSynced(result.accepted.map((a) => a.id));
      await clearSyncedChanges();
    }

    // Apply cross-device dedup remaps for any accepted book entries that
    // the server mapped to a canonical id.
    const changesById = new Map(changes.map((c) => [c.id, c]));
    const affectedEntities = new Set<EntityType>();
    for (const entry of result.accepted) {
      if (!entry.canonicalId) continue;
      const change = changesById.get(entry.id);
      if (!change || change.entity !== "book") continue;
      if (change.entityId === entry.canonicalId) continue;
      await remapBookId(change.entityId, entry.canonicalId);
      affectedEntities.add("book");
      affectedEntities.add("position");
      affectedEntities.add("highlight");
      affectedEntities.add("notebook");
      affectedEntities.add("chat_session");
    }
    if (affectedEntities.size > 0 && typeof window !== "undefined") {
      queueMicrotask(() => {
        for (const entity of affectedEntities) {
          window.dispatchEvent(new CustomEvent("sync:entity-updated", { detail: { entity } }));
        }
      });
    }

    // Fire-and-forget file uploads after metadata push succeeds
    uploadPendingFiles().catch((err) => console.error("[sync] File upload pass failed:", err));
  }

  async function pullChanges(): Promise<void> {
    if (stopped) return;

    // The pull route expects `since` (ISO date) and `entityType` (comma-separated).
    // Use the minimum per-entity cursor so we don't miss any changes.
    // Merge is idempotent so re-fetching already-seen records is safe.
    let minCursor: string | null = null;
    for (const entity of SYNCABLE_ENTITIES) {
      const cursor = await getCursor(entity);
      if (cursor && (!minCursor || cursor < minCursor)) {
        minCursor = cursor;
      }
    }

    const params = new URLSearchParams();
    if (minCursor) {
      params.set("since", minCursor);
    }
    params.set("entityType", SYNCABLE_ENTITIES.join(","));

    syncDebugLog("pull-start", { since: minCursor });

    const res = await fetch(`/api/sync/pull?${params.toString()}`);

    if (res.status === 401) {
      config.onAuthExpired?.();
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

      await setCursor(group.entity, group.cursor);

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

  async function runCycle(fn: () => Promise<void>): Promise<void> {
    let success = false;
    try {
      config.onSyncStart?.();
      await fn();
      success = true;
    } catch (err) {
      config.onSyncError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      config.onSyncEnd?.({ success });
    }
  }

  return {
    pushChanges: () => runCycle(pushChanges),
    pullChanges: () => runCycle(pullChanges),

    startSync() {
      stopped = false;
      // Immediate pull on start
      runCycle(pullChanges);
      pushTimer = setInterval(() => runCycle(pushChanges), PUSH_INTERVAL_MS);
      pullTimer = setInterval(() => runCycle(pullChanges), PULL_INTERVAL_MS);
    },

    stopSync() {
      stopped = true;
      if (pushTimer) {
        clearInterval(pushTimer);
        pushTimer = null;
      }
      if (pullTimer) {
        clearInterval(pullTimer);
        pullTimer = null;
      }
    },

    triggerPush() {
      runCycle(pushChanges);
    },

    triggerPull() {
      runCycle(pullChanges);
    },

    async reloadBookFiles(bookId: string) {
      await reloadBookFiles(bookId);
    },
  };
}
