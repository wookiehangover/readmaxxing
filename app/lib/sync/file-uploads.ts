import { upload } from "@vercel/blob/client";
import { get, set, entries } from "idb-keyval";
import { DEMO_BOOK_ID } from "~/lib/onboarding/demo-content";
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

export async function uploadFile(
  ctx: FileUploadContext,
  bookId: string,
  data: ArrayBuffer | Blob,
  type: "file" | "cover",
  preferredContentType?: string,
): Promise<string | null> {
  if (bookId === DEMO_BOOK_ID) return null;

  const folder = type === "cover" ? "covers" : "books";
  const contentType =
    preferredContentType ||
    (isBlobLike(data) ? data.type : undefined) ||
    (type === "cover" ? "image/jpeg" : "application/epub+zip");
  const extension =
    contentType === "application/pdf"
      ? "pdf"
      : contentType === "image/png"
        ? "png"
        : contentType === "image/webp"
          ? "webp"
          : type === "cover"
            ? "jpg"
            : "epub";
  const fileName = `${type === "cover" ? "cover" : "book"}.${extension}`;
  const blob = isBlobLike(data) ? data : new Blob([data], { type: contentType });
  const pathname = `${folder}/${ctx.userId}/${bookId}/${fileName}`;

  const uploadToVercel = () =>
    upload(pathname, blob, {
      access: "private",
      handleUploadUrl: "/api/sync/files/upload",
      clientPayload: JSON.stringify({ bookId, type }),
      contentType,
    });

  const performUpload = async () => {
    if (import.meta.env.MODE !== "development") return uploadToVercel();

    const response = await fetch(
      `/api/sync/files/upload?bookId=${encodeURIComponent(bookId)}&type=${type}`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": contentType },
        body: blob,
      },
    );
    const result = (await response.json()) as { url?: unknown; error?: unknown; backend?: unknown };

    if (response.status === 409 && result.backend === "vercel") return uploadToVercel();

    if (!response.ok) {
      const error = new Error(
        typeof result.error === "string"
          ? result.error
          : `Upload failed with status ${response.status}`,
      );
      if (response.status === 401 || response.status === 403) error.name = "BlobAccessError";
      if (response.status === 429 || response.status >= 500) error.name = "BlobServiceNotAvailable";
      throw error;
    }

    if (typeof result.url !== "string" || !result.url) {
      throw new Error("Upload response did not include a file URL");
    }

    return { url: result.url };
  };

  const result = await runUploadWithRetry(performUpload, {
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
  });

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
  contentType?: string,
): Promise<string | null> {
  if (bookId === DEMO_BOOK_ID) return null;

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
  const url = await uploadFile(ctx, bookId, data, type, contentType);
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
  options?: { resetBackoff?: boolean },
): Promise<Record<string, unknown> | null> {
  if (options?.resetBackoff) {
    clearUploadRetry(ctx.uploadRetryState, uploadRetryKey(bookId, type));
  }
  const contentType =
    type === "file" && meta.format === "pdf"
      ? "application/pdf"
      : isBlobLike(data)
        ? data.type || undefined
        : undefined;
  const url = await uploadFileWithBackoff(ctx, bookId, data, type, contentType);
  if (!url) return null;
  return stampUploadedUrl(bookId, meta, url, type);
}

/**
 * Scan all books in IDB and upload any that have local file data or cover
 * images but are missing their remote URLs. Runs asynchronously after
 * metadata push — failures are logged but don't block the sync cycle.
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
    if (bookId === DEMO_BOOK_ID) continue;
    let meta = entry[1];
    if (!meta || typeof meta !== "object" || meta.deletedAt) continue;

    try {
      // Upload epub file if missing remoteFileUrl, or repair a stale remote URL
      // when the startup recovery pass finds that the server download is gone.
      const existingFileUrl =
        typeof meta.remoteFileUrl === "string" ? meta.remoteFileUrl : undefined;
      if (!existingFileUrl || options?.verifyExistingRemoteUrls) {
        try {
          const fileData = await get<ArrayBuffer>(bookId, dataStore);
          if (fileData) {
            const shouldUpload = !existingFileUrl || !(await remoteDownloadExists(bookId, "file"));
            if (shouldUpload) {
              const stamped = await uploadLocalCopy(ctx, bookId, meta, fileData, "file", {
                resetBackoff: !!existingFileUrl,
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
 * `remoteCoverUrl`, upload the local file / cover to blob storage so the
 * DB row gets populated (same logic as {@link uploadPendingFiles}, but
 * scoped to one book).
 */
export async function reloadBookFiles(ctx: FileUploadContext, bookId: string): Promise<void> {
  if (!ctx.userId || bookId === DEMO_BOOK_ID) return;

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
          const stamped = await uploadLocalCopy(ctx, bookId, meta, fileData, "file", {
            resetBackoff: true,
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
      const stamped = await uploadLocalCopy(ctx, bookId, meta, fileData, "file");
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
