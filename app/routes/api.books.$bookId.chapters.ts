import type { BookChapter } from "~/lib/epub/epub-text-extract";
import { requireAuth } from "~/lib/database/auth-middleware";
import { getBookByIdForUser } from "~/lib/database/book/book";
import {
  isChapterUploadSessionMismatchError,
  mergeBookChapters,
  replaceBookChaptersWithLock,
  upsertBookChapters,
} from "~/lib/database/book/book-chapters";
import { getEnv } from "~/lib/env.server";

const ENVELOPE_FIELDS = ["uploadId", "chunkIndex", "totalChunks", "totalChapters"] as const;

interface UploadChaptersBody {
  uploadId: string;
  chunkIndex: number;
  totalChunks: number;
  totalChapters: number;
  chapters: BookChapter[];
  format?: string;
}

interface LegacyUploadChaptersBody {
  chapters: BookChapter[];
  format?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function hasValidChapterIndex(value: unknown): value is BookChapter {
  return isRecord(value) && isNonNegativeInteger(value.index);
}

function parseChapters(
  body: Record<string, unknown>,
): { chapters: BookChapter[] } | { error: string } {
  if (!Array.isArray(body.chapters)) {
    return { error: "chapters must be an array" };
  }
  if (body.chapters.some((chapter) => !hasValidChapterIndex(chapter))) {
    return { error: "each chapter must include a non-negative integer index" };
  }
  return { chapters: body.chapters as BookChapter[] };
}

export function parseUploadBody(
  body: unknown,
):
  | { kind: "envelope"; body: UploadChaptersBody }
  | { kind: "legacy"; body: LegacyUploadChaptersBody }
  | { error: string } {
  if (!isRecord(body)) {
    return { error: "body must be an object" };
  }

  const presentEnvelopeFields = ENVELOPE_FIELDS.filter((field) => field in body);
  if (presentEnvelopeFields.length > 0 && presentEnvelopeFields.length < ENVELOPE_FIELDS.length) {
    return {
      error:
        "upload envelope must include uploadId, chunkIndex, totalChunks, and totalChapters together",
    };
  }

  const parsedChapters = parseChapters(body);
  if ("error" in parsedChapters) {
    return parsedChapters;
  }

  if (presentEnvelopeFields.length === 0) {
    if (body.format !== undefined && typeof body.format !== "string") {
      return { error: "format must be a string when provided" };
    }

    return {
      kind: "legacy",
      body: {
        chapters: parsedChapters.chapters,
        format: typeof body.format === "string" ? body.format : undefined,
      },
    };
  }

  if (typeof body.uploadId !== "string" || body.uploadId.length === 0) {
    return { error: "uploadId must be a non-empty string" };
  }
  if (!isNonNegativeInteger(body.chunkIndex)) {
    return { error: "chunkIndex must be a non-negative integer" };
  }
  if (!isPositiveInteger(body.totalChunks)) {
    return { error: "totalChunks must be a positive integer" };
  }
  if (body.chunkIndex >= body.totalChunks) {
    return { error: "chunkIndex must be less than totalChunks" };
  }
  if (!isNonNegativeInteger(body.totalChapters)) {
    return { error: "totalChapters must be a non-negative integer" };
  }
  if (parsedChapters.chapters.length > body.totalChapters) {
    return { error: "chapters length cannot exceed totalChapters" };
  }
  if (body.format !== undefined && typeof body.format !== "string") {
    return { error: "format must be a string when provided" };
  }

  return {
    kind: "envelope",
    body: {
      uploadId: body.uploadId,
      chunkIndex: body.chunkIndex,
      totalChunks: body.totalChunks,
      totalChapters: body.totalChapters,
      chapters: parsedChapters.chapters,
      format: typeof body.format === "string" ? body.format : undefined,
    },
  };
}

function chapterCount(chapters: unknown): number {
  return Array.isArray(chapters) ? chapters.length : 0;
}

/**
 * POST /api/books/:bookId/chapters
 *
 * Upserts extracted chapter text for a (userId, bookId) pair.
 * Called by the client once per book on first open, so the server can
 * reuse the cached chapters on subsequent chat requests.
 *
 * Body: { chapters, format? } or { uploadId, chunkIndex, totalChunks, totalChapters, chapters, format? }
 */
export async function action({
  request,
  params,
}: {
  request: Request;
  params: { bookId: string };
}) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const env = getEnv();
  if (!env.DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }

  const { userId } = await requireAuth(request);

  const bookId = params.bookId;
  if (!bookId) {
    return Response.json({ error: "bookId is required" }, { status: 400 });
  }

  // Verify the book belongs to the user
  const book = await getBookByIdForUser(bookId, userId);
  if (!book) {
    return Response.json({ error: "Book not found" }, { status: 404 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseUploadBody(rawBody);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  if (parsed.kind === "legacy") {
    const row = await upsertBookChapters(userId, bookId, parsed.body.chapters);

    return Response.json({
      ok: true,
      bookId,
      chapterCount: chapterCount(row?.chapters),
      extractedAt: row?.extractedAt ?? null,
    });
  }

  const { body } = parsed;

  let row;
  try {
    row =
      body.chunkIndex === 0
        ? await replaceBookChaptersWithLock(userId, bookId, body.uploadId, body.chapters)
        : await mergeBookChapters(userId, bookId, body.uploadId, body.chapters);
  } catch (err) {
    if (isChapterUploadSessionMismatchError(err)) {
      return Response.json(
        { error: "Upload session superseded; restart from chunk 0" },
        { status: 409 },
      );
    }
    throw err;
  }

  return Response.json({
    ok: true,
    bookId,
    uploadId: body.uploadId,
    chunkIndex: body.chunkIndex,
    totalChunks: body.totalChunks,
    totalChapters: body.totalChapters,
    chapterCount: chapterCount(row?.chapters),
    extractedAt: row?.extractedAt ?? null,
  });
}
