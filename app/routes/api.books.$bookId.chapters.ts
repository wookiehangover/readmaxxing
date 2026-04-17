import type { BookChapter } from "~/lib/epub/epub-text-extract";
import { requireAuth } from "~/lib/database/auth-middleware";
import { getBookByIdForUser } from "~/lib/database/book/book";
import { upsertBookChapters } from "~/lib/database/book/book-chapters";

interface UploadChaptersBody {
  chapters: BookChapter[];
  format?: string;
}

/**
 * POST /api/books/:bookId/chapters
 *
 * Upserts extracted chapter text for a (userId, bookId) pair.
 * Called by the client once per book on first open, so the server can
 * reuse the cached chapters on subsequent chat requests.
 *
 * Body: { chapters: BookChapter[], format?: string }
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

  if (!process.env.DATABASE_URL) {
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

  let body: UploadChaptersBody;
  try {
    body = (await request.json()) as UploadChaptersBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.chapters)) {
    return Response.json({ error: "chapters must be an array" }, { status: 400 });
  }

  const row = await upsertBookChapters(userId, bookId, body.chapters);
  return Response.json({
    ok: true,
    bookId,
    chapterCount: body.chapters.length,
    extractedAt: row?.extractedAt ?? null,
  });
}
