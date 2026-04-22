import { upload } from "@vercel/blob/client";
import { get, set, entries } from "idb-keyval";
import { recordChange } from "./change-log";
import { getBookStore, getBookDataStore } from "./stores";
import { syncDebugLog } from "./sync-debug";
import {
  clearUploadRetry,
  recordUploadFailure,
  runUploadWithRetry,
  shouldAttemptUpload,
  uploadRetryKey,
  type UploadRetryEntry,
} from "./upload-retry";

/**
 * Shared state + callbacks required by the file-upload helpers. The retry
 * Map is owned by the sync engine (one per engine instance) and threaded
 * through so a given book's backoff survives across `uploadPendingFiles`
 * and `reloadBookFiles` invocations.
 */
export interface FileUploadContext {
  /** Authenticated user ID. Used in the blob pathname. */
  readonly userId: string;
  /** Per-book exponential-backoff state, keyed by `${bookId}:${type}`. */
  readonly uploadRetryState: Map<string, UploadRetryEntry>;
  /** Invoked when the upload handshake returns 401. */
  readonly onAuthExpired?: () => void;
}

export async function uploadFile(
  ctx: FileUploadContext,
  bookId: string,
  data: ArrayBuffer | Blob,
  type: "file" | "cover",
): Promise<string | null> {
  const folder = type === "cover" ? "covers" : "books";
  const fileName = type === "cover" ? "cover.jpg" : "book.epub";
  const contentType = type === "cover" ? "image/jpeg" : "application/epub+zip";
  const blob = data instanceof Blob ? data : new Blob([data], { type: contentType });
  const pathname = `${folder}/${ctx.userId}/${bookId}/${fileName}`;

  const result = await runUploadWithRetry(
    () =>
      upload(pathname, blob, {
        access: "private",
        handleUploadUrl: "/api/sync/files/upload",
        clientPayload: JSON.stringify({ bookId, type }),
        contentType,
      }),
    {
      onAuthExpired: () => ctx.onAuthExpired?.(),
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
 * Wrapper around {@link uploadFile} that enforces the per-book exponential
 * backoff. On success the retry state for this book+type is cleared; on
 * failure (null return) the next-attempt timestamp is pushed forward along
 * the `UPLOAD_BACKOFF_SCHEDULE_MS` schedule.
 */
export async function uploadFileWithBackoff(
  ctx: FileUploadContext,
  bookId: string,
  data: ArrayBuffer | Blob,
  type: "file" | "cover",
): Promise<string | null> {
  const key = uploadRetryKey(bookId, type);
  const decision = shouldAttemptUpload(ctx.uploadRetryState, key, Date.now());
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
  const url = await uploadFile(ctx, bookId, data, type);
  if (url) {
    clearUploadRetry(ctx.uploadRetryState, key);
    syncDebugLog("upload-success", { bookId, type, size });
  } else {
    recordUploadFailure(ctx.uploadRetryState, key, Date.now());
    syncDebugLog("upload-failed", { bookId, type, size });
  }
  return url;
}

/**
 * Scan all books in IDB and upload any that have local file data or cover
 * images but are missing their remote URLs. Runs asynchronously after
 * metadata push — failures are logged but don't block the sync cycle.
 */
export async function uploadPendingFiles(
  ctx: FileUploadContext,
  options?: { isStopped?: () => boolean },
): Promise<void> {
  if (options?.isStopped?.()) return;
  // Safety: never attempt uploads before userId is known.
  if (!ctx.userId) return;

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
        const url = await uploadFileWithBackoff(ctx, bookId, fileData, "file");
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
      const url = await uploadFileWithBackoff(ctx, bookId, meta.coverImage, "cover");
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
      window.dispatchEvent(new CustomEvent("sync:entity-updated", { detail: { entity: "book" } }));
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
export async function reloadBookFiles(ctx: FileUploadContext, bookId: string): Promise<void> {
  if (!ctx.userId) return;

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
      const url = await uploadFileWithBackoff(ctx, bookId, fileData, "file");
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
    const url = await uploadFileWithBackoff(ctx, bookId, meta.coverImage, "cover");
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
      window.dispatchEvent(new CustomEvent("sync:entity-updated", { detail: { entity: "book" } }));
    });
  }
}
