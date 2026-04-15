import { requireAuth } from "~/lib/database/auth-middleware";
import { getBookByIdForUser } from "~/lib/database/book/book";

/**
 * GET /api/sync/files/download?bookId=...&type=file|cover
 *
 * Downloads a book file or cover image from Vercel Blob storage.
 *
 * Query params:
 *   - bookId: string (required)
 *   - type: "file" (default) | "cover"
 *
 * Since we use public blob storage, this redirects to the blob URL.
 */
export async function loader({ request }: { request: Request }) {
  const { userId } = await requireAuth(request);

  const url = new URL(request.url);
  const bookId = url.searchParams.get("bookId");
  const type = url.searchParams.get("type") ?? "file";

  if (!bookId) {
    return Response.json({ error: "bookId is required" }, { status: 400 });
  }

  if (type !== "file" && type !== "cover") {
    return Response.json(
      { error: 'Invalid type parameter. Must be "file" or "cover".' },
      { status: 400 },
    );
  }

  const book = await getBookByIdForUser(bookId, userId);
  if (!book) {
    return Response.json({ error: "Book not found" }, { status: 404 });
  }

  const blobUrl = type === "cover" ? book.coverBlobUrl : book.fileBlobUrl;
  if (!blobUrl) {
    return Response.json({ error: `No ${type} uploaded for this book` }, { status: 404 });
  }

  // Public blobs: redirect to the blob URL directly
  return Response.redirect(blobUrl, 302);
}
