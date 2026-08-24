import { get } from "idb-keyval";
import { uploadChapters } from "~/lib/chat/upload-chapters";
import type { BookChapter } from "~/lib/epub/epub-text-extract";
import { DEMO_BOOK_ID } from "~/lib/onboarding/demo-content";
import { isChaptersUploaded } from "~/lib/stores/chapter-upload-cache-store";
import { getBookDataStore, getBookStore } from "./stores";

interface ExtractedBookChapters {
  chapters: BookChapter[];
  format: string | undefined;
}

const pendingUploads = new Map<string, Promise<void>>();

async function extractChapters(
  data: ArrayBuffer,
  format: string | undefined,
): Promise<BookChapter[]> {
  if (format === "pdf") {
    const { extractPdfChapters } = await import("~/lib/pdf/pdf-text-extract");
    return extractPdfChapters(data);
  }

  const { extractBookChapters } = await import("~/lib/epub/epub-text-extract");
  return extractBookChapters(data);
}

async function uploadStoredBookChapters(
  bookId: string,
  force: boolean,
  extracted?: ExtractedBookChapters,
): Promise<void> {
  if (!force && (await isChaptersUploaded(bookId))) return;

  let source = extracted;
  if (!source) {
    const rawMeta = await get<Record<string, unknown>>(bookId, getBookStore());
    if (!rawMeta || typeof rawMeta !== "object" || rawMeta.deletedAt) return;

    const data = await get<ArrayBuffer>(bookId, getBookDataStore());
    if (!data) return;

    const format = typeof rawMeta.format === "string" ? rawMeta.format : "epub";
    try {
      source = { chapters: await extractChapters(data, format), format };
    } catch (err) {
      console.warn("Failed to extract book chapters during sync:", err);
      return;
    }
  }

  if (source.chapters.length === 0) return;
  await uploadChapters(bookId, source.chapters, source.format, { force });
}

function startBookChapterUpload(
  bookId: string,
  force: boolean,
  extracted?: ExtractedBookChapters,
): Promise<void> {
  if (bookId === DEMO_BOOK_ID) return Promise.resolve();

  const current = pendingUploads.get(bookId);
  if (current) return current;

  let pending: Promise<void>;
  pending = uploadStoredBookChapters(bookId, force, extracted).finally(() => {
    if (pendingUploads.get(bookId) === pending) pendingUploads.delete(bookId);
  });
  pendingUploads.set(bookId, pending);
  return pending;
}

export function ensureBookChaptersUploaded(
  bookId: string,
  extracted?: ExtractedBookChapters,
): Promise<void> {
  return startBookChapterUpload(bookId, false, extracted);
}

export function reuploadBookChapters(bookId: string): Promise<void> {
  return startBookChapterUpload(bookId, true);
}
