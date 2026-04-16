import { get } from "@vercel/blob";
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
 * Private blobs require authenticated access via get(), which returns
 * a stream that we proxy to the client.
 */
export async function loader({ request }: { request: Request }) {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }

  const { userId } = await requireAuth(request);

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return Response.json({ error: "Blob storage is not configured" }, { status: 500 });
  }

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

  // Private blobs: use get() to fetch via authenticated token and stream to client
  const result = await get(blobUrl, { access: "private", token });

  if (!result || result.statusCode !== 200 || !result.stream) {
    return Response.json({ error: "Failed to retrieve file from blob storage" }, { status: 502 });
  }

  return new Response(result.stream, {
    headers: {
      "Content-Type": result.blob.contentType ?? "application/octet-stream",
      "Content-Disposition": result.blob.contentDisposition,
    },
  });
}
