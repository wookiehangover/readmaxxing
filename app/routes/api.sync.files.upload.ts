import { put } from "@vercel/blob";
import { requireAuth } from "~/lib/database/auth-middleware";
import { getBookByIdForUser, updateBookBlobUrls } from "~/lib/database/book/book";

/**
 * POST /api/sync/files/upload
 *
 * Uploads a book file or cover image to Vercel Blob storage.
 *
 * Query params:
 *   - type: "file" (default) | "cover"
 *
 * Body: multipart/form-data with fields:
 *   - bookId: string (required)
 *   - file: File (required)
 */
export async function action({ request }: { request: Request }) {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }

  const { userId } = await requireAuth(request);

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return Response.json({ error: "Blob storage is not configured" }, { status: 500 });
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "file";
  if (type !== "file" && type !== "cover") {
    return Response.json(
      { error: 'Invalid type parameter. Must be "file" or "cover".' },
      { status: 400 },
    );
  }

  const formData = await request.formData();
  const bookId = formData.get("bookId");
  const file = formData.get("file");

  if (!bookId || typeof bookId !== "string") {
    return Response.json({ error: "bookId is required" }, { status: 400 });
  }

  if (!file || !(file instanceof File)) {
    return Response.json({ error: "file is required" }, { status: 400 });
  }

  // Verify the book belongs to the user
  const book = await getBookByIdForUser(bookId, userId);
  if (!book) {
    return Response.json({ error: "Book not found" }, { status: 404 });
  }

  const folder = type === "cover" ? "covers" : "books";
  const pathname = `${folder}/${userId}/${bookId}/${file.name}`;

  const blob = await put(pathname, file, {
    access: "private",
    token,
    allowOverwrite: true,
  });

  // Update the book record in Postgres
  if (type === "cover") {
    await updateBookBlobUrls(bookId, { coverBlobUrl: blob.url });
  } else {
    await updateBookBlobUrls(bookId, { fileBlobUrl: blob.url });
  }

  return Response.json({ url: blob.url, pathname: blob.pathname });
}
