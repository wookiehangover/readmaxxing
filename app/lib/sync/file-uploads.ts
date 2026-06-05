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
  /** Authenticated user ID. Uploads are rejected until this is known. */
  readonly userId: string;
  /** Per-book exponential-backoff state, keyed by `${bookId}:${type}`. */
  readonly uploadRetryState: Map<string, UploadRetryEntry>;
  /** Invoked when the upload handshake returns 401. */
  readonly onAuthExpired?: () => void;
}

type BookFileFormat = "epub" | "pdf";
type FileUploadType = "file" | "cover";

export interface UploadPendingFilesOptions {
  readonly isStopped?: () => boolean;
  readonly verifyExistingRemoteUrls?: boolean;
}

export function resetUploadBackoff(ctx: FileUploadContext): void {
  ctx.uploadRetryState.clear();
}

function isBlobLike(value: unknown): value is Blob {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Blob).arrayBuffer === "function" &&
    typeof (value as Blob).size === "number"
  );
}

function makeUploadError(status: number, message: string): Error {
  const err = new Error(message);
  if (status === 401 || status === 403) err.name = "UploadAccessError";
  else if (status === 413) err.name = "UploadFileTooLargeError";
  else if (status === 415) err.name = "UploadContentTypeNotAllowedError";
  else if (status === 408 || status === 429 || status >= 500) err.name = "UploadServerError";
  else err.name = "UploadPermanentError";
  return err;
}

function contentTypeForUpload(
  data: ArrayBuffer | Blob,
  type: FileUploadType,
  format: BookFileFormat,
): string {
  if (isBlobLike(data) && data.type) return data.type;
  if (type === "cover") return "image/jpeg";
  return format === "pdf" ? "application/pdf" : "application/epub+zip";
}

export async function uploadFile(
  ctx: FileUploadContext,
  bookId: string,
  data: ArrayBuffer | Blob,
  type: "file" | "cover",
  format: BookFileFormat = "epub",
): Promise<string | null> {
  const contentType = contentTypeForUpload(data, type, format);
  const blob = isBlobLike(data) ? data : new Blob([data], { type: contentType });

  const result = await runUploadWithRetry(
    async () => {
      const res = await fetch(
        `/api/sync/files/upload?bookId=${encodeURIComponent(bookId)}&type=${type}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": contentType },
          body: blob,
        },
      );

      const payload = (await res.json().catch(() => null)) as {
        url?: unknown;
        error?: unknown;
      } | null;
      if (!res.ok) {
        const message =
          typeof payload?.error === "string" ? payload.error : `Upload failed: ${res.status}`;
        throw makeUploadError(res.status, message);
      }
      if (typeof payload?.url !== "string") {
        throw makeUploadError(502, "Upload response did not include a storage URL");
      }
      return { url: payload.url };
    },
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
  type: FileUploadType,
  format: BookFileFormat = "epub",
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
  const size = isBlobLike(data) ? data.size : data.byteLength;
  syncDebugLog("upload-attempt", { bookId, type, size });
  const url = await uploadFile(ctx, bookId, data, type, format);
  if (url) {
    clearUploadRetry(ctx.uploadRetryState, key);
    syncDebugLog("upload-success", { bookId, type, size });
  } else {
    recordUploadFailure(ctx.uploadRetryState, key, Date.now());
    syncDebugLog("upload-failed", { bookId, type, size });
  }
  return url;
}

async function remoteDownloadExists(bookId: string, type: FileUploadType): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/sync/files/download?bookId=${encodeURIComponent(bookId)}&type=${type}`,
      { credentials: "include" },
    );
    if (res.ok) return true;
    console.error(`[sync] ${type} download check failed: ${res.status} ${res.statusText}`);
  } catch (err) {
    console.error(`[sync] ${type} download check failed:`, err);
  }
  return false;
}

async function stampUploadedUrl(
  bookId: string,
  meta: Record<string, unknown>,
  url: string,
  type: FileUploadType,
): Promise<Record<string, unknown>> {
  const bookStore = getBookStore();
  const urlKey = type === "file" ? "remoteFileUrl" : "remoteCoverUrl";
  const stamped = {
    ...meta,
    [urlKey]: url,
    hasLocalFile: true,
    updatedAt: Date.now(),
  };
  await set(bookId, stamped, bookStore);
  await recordChange({
    entity: "book",
    entityId: bookId,
    operation: "put",
    data: stamped,
    timestamp: stamped.updatedAt,
  });
  return stamped;
}

async function uploadLocalCopy(
  ctx: FileUploadContext,
  bookId: string,
  meta: Record<string, unknown>,
  data: ArrayBuffer | Blob,
  type: FileUploadType,
  options?: { resetBackoff?: boolean; format?: BookFileFormat },
): Promise<Record<string, unknown> | null> {
  if (options?.resetBackoff) {
    clearUploadRetry(ctx.uploadRetryState, uploadRetryKey(bookId, type));
  }
  const url = await uploadFileWithBackoff(ctx, bookId, data, type, options?.format ?? "epub");
  if (!url) return null;
  return stampUploadedUrl(bookId, meta, url, type);
}

/**
 * Scan all books in IDB and upload any that have local file data or cover
 * images but are missing their remote storage references. Runs asynchronously
 * after metadata push — failures are logged but don't block the sync cycle.
 */
export async function uploadPendingFiles(
  ctx: FileUploadContext,
  options?: UploadPendingFilesOptions,
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
    let meta = entry[1];
    if (!meta || typeof meta !== "object" || meta.deletedAt) continue;

    try {
      // Upload epub/pdf file if missing remoteFileUrl, or repair a stale remote
      // URL when the startup recovery pass finds that the server download is gone.
      const existingFileUrl =
        typeof meta.remoteFileUrl === "string" ? meta.remoteFileUrl : undefined;
      if (!existingFileUrl || options?.verifyExistingRemoteUrls) {
        try {
          const fileData = await get<ArrayBuffer>(bookId, dataStore);
          if (fileData) {
            const shouldUpload = !existingFileUrl || !(await remoteDownloadExists(bookId, "file"));
            if (shouldUpload) {
              const format = meta.format === "pdf" ? "pdf" : "epub";
              const stamped = await uploadLocalCopy(ctx, bookId, meta, fileData, "file", {
                resetBackoff: !!existingFileUrl,
                format,
              });
              if (stamped) meta = stamped;
            }
          }
        } catch (err) {
          console.error(`[sync] pending file upload failed for ${bookId}:`, err);
        }
      }

      // Upload cover image if missing remoteCoverUrl. Once any remote URL
      // is recorded, the cover is not re-uploaded on subsequent sync cycles;
      // private covers are served via the proxy fallback.
      const existingCoverUrl =
        typeof meta.remoteCoverUrl === "string" ? meta.remoteCoverUrl : undefined;
      const coverImage = meta.coverImage;
      if (isBlobLike(coverImage) && (!existingCoverUrl || options?.verifyExistingRemoteUrls)) {
        try {
          const shouldUpload = !existingCoverUrl || !(await remoteDownloadExists(bookId, "cover"));
          if (shouldUpload) {
            const stamped = await uploadLocalCopy(ctx, bookId, meta, coverImage, "cover", {
              resetBackoff: !!existingCoverUrl,
            });
            if (stamped) meta = stamped;
          }
        } catch (err) {
          console.error(`[sync] pending cover upload failed for ${bookId}:`, err);
        }
      }
    } catch (err) {
      console.error(`[sync] pending book upload failed for ${bookId}:`, err);
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
 * `remoteCoverUrl`, upload the local file / cover to R2 storage so the
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
        const fileData = await get<ArrayBuffer>(bookId, dataStore);
        if (fileData) {
          const format = meta.format === "pdf" ? "pdf" : "epub";
          const stamped = await uploadLocalCopy(ctx, bookId, meta, fileData, "file", {
            resetBackoff: true,
            format,
          });
          if (stamped) {
            meta = stamped;
            metaChanged = true;
          }
        }
      }
    } catch (err) {
      console.error("[sync] reload file download failed:", err);
    }
  } else {
    const fileData = await get<ArrayBuffer>(bookId, dataStore);
    if (fileData) {
      const format = meta.format === "pdf" ? "pdf" : "epub";
      const stamped = await uploadLocalCopy(ctx, bookId, meta, fileData, "file", { format });
      if (stamped) {
        meta = stamped;
        metaChanged = true;
      }
    }
  }

  // --- Cover ---
  // Re-upload covers that are missing a remote URL, provided we have the
  // local blob to source from. Otherwise fall back to downloading the
  // existing remote copy (the proxy handles private URLs for users
  // without a local blob).
  const existingCoverUrl =
    typeof meta.remoteCoverUrl === "string" ? meta.remoteCoverUrl : undefined;
  const coverImage = meta.coverImage;
  if (isBlobLike(coverImage) && !existingCoverUrl) {
    const stamped = await uploadLocalCopy(ctx, bookId, meta, coverImage, "cover");
    if (stamped) {
      meta = stamped;
      metaChanged = true;
    }
  } else if (existingCoverUrl) {
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
        const localCoverImage = meta.coverImage;
        if (isBlobLike(localCoverImage)) {
          const stamped = await uploadLocalCopy(ctx, bookId, meta, localCoverImage, "cover", {
            resetBackoff: true,
          });
          if (stamped) {
            meta = stamped;
            metaChanged = true;
          }
        }
      }
    } catch (err) {
      console.error("[sync] reload cover download failed:", err);
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
