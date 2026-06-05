import { getBookByIdForUser } from "~/lib/database/book/book";
import { getShareLink, type ShareLinkRow } from "~/lib/database/share/share-link";
import { parseStoredBlobReference } from "~/lib/blob-url";
import { getEnv } from "~/lib/env.server";

function isExpired(shareLink: ShareLinkRow): boolean {
  return shareLink.expiresAt != null && shareLink.expiresAt.getTime() <= Date.now();
}

export async function loader({ params }: { params: { id: string } }) {
  const env = getEnv();
  if (!env.DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
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

  const reference = parseStoredBlobReference(book.coverBlobUrl, "cover");
  if (!reference) {
    return Response.json({ error: "Unsupported storage reference" }, { status: 400 });
  }

  const bucket = reference.bucket === "covers" ? env.R2_COVERS : env.R2_FILES;
  if (!bucket) {
    return Response.json({ error: "R2 storage is not configured" }, { status: 500 });
  }

  const object = await bucket.get(reference.key);
  if (!object) {
    return Response.json({ error: "Cover not found in storage" }, { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=3600");
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers });
}
