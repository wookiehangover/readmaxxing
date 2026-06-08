import { requireAuth } from "~/lib/database/auth-middleware";
import { getBookByIdForUser } from "~/lib/database/book/book";
import { parseStoredBlobReference } from "~/lib/blob-url";
import { getEnv } from "~/lib/env.server";

/**
 * GET /api/sync/files/download?bookId=...&type=file|cover
 *
 * Downloads a book file or cover image from private R2 storage.
 *
 * Query params:
 *   - bookId: string (required)
 *   - type: "file" (default) | "cover"
 *
 */
export async function loader({ request }: { request: Request }) {
  const env = getEnv();
  if (!env.DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }

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

  const storedReference = type === "cover" ? book.coverBlobUrl : book.fileBlobUrl;
  if (!storedReference) {
    return Response.json({ error: `No ${type} uploaded for this book` }, { status: 404 });
  }

  const reference = parseStoredBlobReference(storedReference, type);
  if (!reference) {
    return Response.json({ error: "Unsupported storage reference" }, { status: 400 });
  }

  const bucket = reference.bucket === "covers" ? env.R2_COVERS : env.R2_FILES;
  if (!bucket) {
    return Response.json({ error: "R2 storage is not configured" }, { status: 500 });
  }

  const object = await bucket.get(reference.key, { range: request.headers });
  if (!object) {
    return Response.json({ error: "File not found in storage" }, { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Accept-Ranges", "bytes");
  headers.set("ETag", object.httpEtag);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/octet-stream");
  if (type === "cover") headers.set("Cache-Control", "private, max-age=31536000, immutable");

  const range = object.range;
  if (range) {
    const { start, end, length } = r2RangeBounds(range, object.size);
    headers.set("Content-Range", `bytes ${start}-${end}/${object.size}`);
    headers.set("Content-Length", String(length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers });
}

function r2RangeBounds(
  range: R2Range,
  size: number,
): { start: number; end: number; length: number } {
  if ("suffix" in range) {
    const length = Math.min(range.suffix, size);
    const start = Math.max(size - length, 0);
    return { start, end: size - 1, length };
  }

  const start = range.offset ?? 0;
  const length = Math.min(range.length ?? size - start, size - start);
  return { start, end: start + length - 1, length };
}
