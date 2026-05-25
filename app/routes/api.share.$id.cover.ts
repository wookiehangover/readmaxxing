import { get } from "@vercel/blob";
import { getBookByIdForUser } from "~/lib/database/book/book";
import { getShareLink, type ShareLinkRow } from "~/lib/database/share/share-link";

function isExpired(shareLink: ShareLinkRow): boolean {
  return shareLink.expiresAt != null && shareLink.expiresAt.getTime() <= Date.now();
}

export async function loader({ params }: { params: { id: string } }) {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return Response.json({ error: "Blob storage is not configured" }, { status: 500 });
  }

  const shareLink = await getShareLink(params.id);
  if (!shareLink) {
    return Response.json({ error: "Share link not found" }, { status: 404 });
  }
  if (isExpired(shareLink)) {
    return Response.json({ error: "Share link expired" }, { status: 410 });
  }

  const book = await getBookByIdForUser(shareLink.bookId, shareLink.userId);
  if (!book || book.deletedAt) {
    return Response.json({ error: "Book not found" }, { status: 404 });
  }
  if (!book.coverBlobUrl) {
    return Response.json({ error: "No cover uploaded for this book" }, { status: 404 });
  }

  const result = await get(book.coverBlobUrl, { access: "private", token });
  if (!result || result.statusCode !== 200 || !result.stream) {
    return Response.json({ error: "Failed to retrieve cover from blob storage" }, { status: 502 });
  }

  return new Response(result.stream, {
    headers: {
      "Content-Type": result.blob.contentType ?? "application/octet-stream",
      "Content-Disposition": result.blob.contentDisposition,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
