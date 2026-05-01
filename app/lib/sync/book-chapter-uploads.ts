import { get } from "idb-keyval";
import { uploadChapters } from "~/lib/chat/upload-chapters";
import type { BookChapter } from "~/lib/epub/epub-text-extract";
import { getBookDataStore, getBookStore } from "./stores";

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

export async function reuploadBookChapters(bookId: string): Promise<void> {
  const rawMeta = await get<Record<string, unknown>>(bookId, getBookStore());
  if (!rawMeta || typeof rawMeta !== "object" || rawMeta.deletedAt) return;

  const data = await get<ArrayBuffer>(bookId, getBookDataStore());
  if (!data) return;

  const format = typeof rawMeta.format === "string" ? rawMeta.format : "epub";

  let chapters: BookChapter[] = [];
  try {
    chapters = await extractChapters(data, format);
  } catch (err) {
    console.warn("Failed to extract book chapters during sync:", err);
    return;
  }

  if (chapters.length === 0) return;
  await uploadChapters(bookId, chapters, format, { force: true });
}
