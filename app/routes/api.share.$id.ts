import { getBookByIdForUser, type BookRow } from "~/lib/database/book/book";
import {
  getShareLink,
  incrementUseCount,
  type ShareLinkRow,
} from "~/lib/database/share/share-link";
import { signDownloadToken, verifyDownloadToken } from "~/lib/share-download-token";
import { parseStoredBlobReference } from "~/lib/blob-url";
import { getEnv } from "~/lib/env.server";

function isExpired(shareLink: ShareLinkRow): boolean {
  return shareLink.expiresAt != null && shareLink.expiresAt.getTime() <= Date.now();
}

function isExhausted(shareLink: ShareLinkRow): boolean {
  return shareLink.maxUses != null && shareLink.useCount >= shareLink.maxUses;
}

async function getSharedBook(shareLink: ShareLinkRow): Promise<BookRow | null> {
  const book = await getBookByIdForUser(shareLink.bookId, shareLink.userId);
  if (!book || book.deletedAt) return null;
  return book;
}

async function streamSharedFile(shareLink: ShareLinkRow, book: BookRow) {
  if (!book.fileBlobUrl) {
    return Response.json({ error: "No file uploaded for this book" }, { status: 404 });
  }

  const reference = parseStoredBlobReference(book.fileBlobUrl, "file");
  if (!reference) {
    return Response.json({ error: "Unsupported storage reference" }, { status: 400 });
  }

  const env = getEnv();
  const bucket = reference.bucket === "covers" ? env.R2_COVERS : env.R2_FILES;
  if (!bucket) {
    return Response.json({ error: "R2 storage is not configured" }, { status: 500 });
  }

  const object = await bucket.get(reference.key);
  if (!object) {
    return Response.json({ error: "File not found in storage" }, { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/octet-stream");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Share-Id", shareLink.id);
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers });
}

export async function loader({ request, params }: { request: Request; params: { id: string } }) {
  if (!getEnv().DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }

  const shareLink = await getShareLink(params.id);
  if (!shareLink) {
    return Response.json({ error: "Share link not found" }, { status: 404 });
  }
  if (isExpired(shareLink)) {
    return Response.json({ error: "Share link expired" }, { status: 410 });
  }

  const url = new URL(request.url);
  const downloadToken = url.searchParams.get("download");
  if (downloadToken) {
    if (!verifyDownloadToken(downloadToken, shareLink)) {
      return Response.json({ error: "Invalid download token" }, { status: 403 });
    }

    const book = await getSharedBook(shareLink);
    if (!book) {
      return Response.json({ error: "Book not found" }, { status: 404 });
    }
    return streamSharedFile(shareLink, book);
  }

  if (isExhausted(shareLink)) {
    return Response.json({ error: "Share link exhausted" }, { status: 410 });
  }

  const book = await getSharedBook(shareLink);
  if (!book) {
    return Response.json({ error: "Book not found" }, { status: 404 });
  }
  if (!book.fileBlobUrl) {
    return Response.json({ error: "No file uploaded for this book" }, { status: 404 });
  }

  const incrementedShareLink = await incrementUseCount(shareLink.id);
  if (!incrementedShareLink) {
    return Response.json({ error: "Share link exhausted" }, { status: 410 });
  }

  const fileToken = signDownloadToken(incrementedShareLink.id, incrementedShareLink.useCount);
  if (!fileToken) {
    return Response.json({ error: "Download signing is not configured" }, { status: 500 });
  }

  return Response.json({
    book: {
      title: book.title,
      author: book.author,
      coverUrl: book.coverBlobUrl
        ? new URL(`/api/share/${params.id}/cover`, request.url).toString()
        : null,
      format: book.format,
    },
    fileUrl: new URL(
      `/api/share/${params.id}?download=${encodeURIComponent(fileToken)}`,
      request.url,
    ).toString(),
    shareChats: incrementedShareLink.shareChats,
    sharerId: incrementedShareLink.userId,
  });
}
