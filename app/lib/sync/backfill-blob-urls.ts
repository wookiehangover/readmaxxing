import { createStore, entries } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import type { BookMeta } from "~/lib/stores/book-store";
import { recordChange } from "./change-log";

const BACKFILL_FLAG_KEY = "readmax:blob-url-backfill:v1";

let _bookStore: UseStore | null = null;

function getBookStore(): UseStore {
  if (!_bookStore) _bookStore = createStore("ebook-reader-db", "books");
  return _bookStore;
}

/**
 * One-time migration that re-enqueues a `book` change for every locally
 * stored book that already has `remoteFileUrl` or `remoteCoverUrl` set.
 *
 * Before this migration, blob URLs only reached Postgres via the
 * `onUploadCompleted` webhook in `api.sync.files.upload.ts`. That webhook
 * is unreliable (timing, silent failures, row-not-yet-inserted races), so
 * books uploaded prior to the push-carries-URLs fix have null
 * `cover_blob_url` / `file_blob_url` columns in prod. Re-pushing these
 * records on first sync after upgrade flushes the URLs through the new
 * push handler path (which calls `updateBookBlobUrls` with COALESCE).
 *
 * Gated on a localStorage flag so it runs at most once per device.
 * Tolerant of per-book errors — a failure on one book is logged and the
 * loop continues.
 */
export async function runBlobUrlBackfillIfNeeded(): Promise<void> {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(BACKFILL_FLAG_KEY)) return;

  const bookStore = getBookStore();

  let allEntries: Array<[IDBValidKey, unknown]>;
  try {
    allEntries = await entries(bookStore);
  } catch (err) {
    console.error("[backfill-blob-urls] Failed to read book store:", err);
    return;
  }

  let enqueued = 0;
  for (const [id, raw] of allEntries) {
    const meta = raw as BookMeta | undefined;
    if (!meta || typeof meta !== "object") continue;
    if (meta.deletedAt) continue;
    if (!meta.remoteFileUrl && !meta.remoteCoverUrl) continue;

    try {
      await recordChange({
        entity: "book",
        entityId: meta.id ?? String(id),
        operation: "put",
        data: meta,
        timestamp: meta.updatedAt ?? Date.now(),
      });
      enqueued++;
    } catch (err) {
      console.error(`[backfill-blob-urls] Failed to enqueue book ${String(id)}:`, err);
    }
  }

  try {
    localStorage.setItem(BACKFILL_FLAG_KEY, "1");
  } catch (err) {
    console.error("[backfill-blob-urls] Failed to set completion flag:", err);
  }

  if (enqueued > 0) {
    console.log(`[backfill-blob-urls] Enqueued ${enqueued} book(s) for blob URL push`);
  }
}
