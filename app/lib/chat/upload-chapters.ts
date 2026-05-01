import type { BookChapter } from "~/lib/epub/epub-text-extract";
import { isChaptersUploaded, markChaptersUploaded } from "~/lib/stores/chapter-upload-cache-store";

export const CHAPTER_UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024;

function serializedJsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function createChapterUploadChunks(chapters: BookChapter[]): BookChapter[][] {
  const chunks: BookChapter[][] = [];
  let current: BookChapter[] = [];

  for (const chapter of chapters) {
    const singleChapterBytes = serializedJsonByteLength([chapter]);
    if (singleChapterBytes > CHAPTER_UPLOAD_CHUNK_BYTES) {
      // TODO(spec: Add chunked chapter upload): split oversized chapters instead of skipping them.
      console.warn("Skipping oversized chapter upload chunk:", {
        chapterIndex: chapter.index,
        bytes: singleChapterBytes,
        limit: CHAPTER_UPLOAD_CHUNK_BYTES,
      });
      continue;
    }

    if (current.length === 0) {
      current = [chapter];
      continue;
    }

    const nextChunk = [...current, chapter];
    if (serializedJsonByteLength(nextChunk) > CHAPTER_UPLOAD_CHUNK_BYTES) {
      chunks.push(current);
      current = [chapter];
    } else {
      current = nextChunk;
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

function createChapterUploadId(bookId: string): string {
  return globalThis.crypto?.randomUUID?.() ?? `${bookId}-${Date.now()}-${Math.random()}`;
}

export async function uploadChapters(
  bookId: string,
  chapters: BookChapter[],
  format: string | undefined,
  options: { force?: boolean } = {},
): Promise<void> {
  if (!options.force && (await isChaptersUploaded(bookId))) return;

  const chunks = createChapterUploadChunks(chapters);
  if (chunks.length === 0) return;

  const uploadId = createChapterUploadId(bookId);
  const totalChapters = chunks.reduce((count, chunk) => count + chunk.length, 0);

  for (const [chunkIndex, chunk] of chunks.entries()) {
    const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/chapters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uploadId,
        chunkIndex,
        totalChunks: chunks.length,
        totalChapters,
        chapters: chunk,
        format,
      }),
    });

    if (res.ok) continue;

    if (res.status === 409) {
      console.debug("Chapter upload session superseded; retrying from chunk 0 next open", {
        bookId,
        uploadId,
        chunkIndex,
      });
      return;
    }

    // 401 (signed out) / 503 (sync off) are expected — don't mark, try again next open
    if (res.status !== 401 && res.status !== 503) {
      console.error("Failed to upload chapters:", res.status, await res.text().catch(() => ""));
    }
    return;
  }

  await markChaptersUploaded(bookId);
}

export async function uploadChaptersOnce(
  bookId: string,
  chapters: BookChapter[],
  format: string | undefined,
): Promise<void> {
  await uploadChapters(bookId, chapters, format);
}
