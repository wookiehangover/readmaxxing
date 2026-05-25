import { createHmac, timingSafeEqual } from "node:crypto";
import { get } from "@vercel/blob";
import { getBookByIdForUser, type BookRow } from "~/lib/database/book/book";
import {
  getShareLink,
  incrementUseCount,
  type ShareLinkRow,
} from "~/lib/database/share/share-link";

const DOWNLOAD_TOKEN_TTL_MS = 5 * 60 * 1000;

function isExpired(shareLink: ShareLinkRow): boolean {
  return shareLink.expiresAt != null && shareLink.expiresAt.getTime() <= Date.now();
}

function isExhausted(shareLink: ShareLinkRow): boolean {
  return shareLink.maxUses != null && shareLink.useCount >= shareLink.maxUses;
}

function getDownloadSecret(): string | null {
  return process.env.SHARE_DOWNLOAD_SECRET ?? process.env.BLOB_READ_WRITE_TOKEN ?? null;
}

function signDownloadToken(shareId: string, useCount: number): string | null {
  const secret = getDownloadSecret();
  if (!secret) return null;

  const expiresAt = Date.now() + DOWNLOAD_TOKEN_TTL_MS;
  const data = `${shareId}.${useCount}.${expiresAt}`;
  const signature = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

function verifyDownloadToken(token: string, shareLink: ShareLinkRow): boolean {
  const secret = getDownloadSecret();
  if (!secret) return false;

  const parts = token.split(".");
  if (parts.length !== 4) return false;

  const [shareId, useCountText, expiresAtText, signature] = parts;
  const expiresAt = Number(expiresAtText);
  const useCount = Number(useCountText);
  if (
    shareId !== shareLink.id ||
    useCount !== shareLink.useCount ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    return false;
  }

  const data = `${shareId}.${useCountText}.${expiresAtText}`;
  const expected = createHmac("sha256", secret).update(data).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

async function getSharedBook(shareLink: ShareLinkRow): Promise<BookRow | null> {
  const book = await getBookByIdForUser(shareLink.bookId, shareLink.userId);
  if (!book || book.deletedAt) return null;
  return book;
}

async function streamSharedFile(shareLink: ShareLinkRow, book: BookRow) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return Response.json({ error: "Blob storage is not configured" }, { status: 500 });
  }
  if (!book.fileBlobUrl) {
    return Response.json({ error: "No file uploaded for this book" }, { status: 404 });
  }

  const result = await get(book.fileBlobUrl, { access: "private", token });
  if (!result || result.statusCode !== 200 || !result.stream) {
    return Response.json({ error: "Failed to retrieve file from blob storage" }, { status: 502 });
  }

  return new Response(result.stream, {
    headers: {
      "Content-Type": result.blob.contentType ?? "application/octet-stream",
      "Content-Disposition": result.blob.contentDisposition,
      "Cache-Control": "no-store",
      "X-Share-Id": shareLink.id,
    },
  });
}

export async function loader({ request, params }: { request: Request; params: { id: string } }) {
  if (!process.env.DATABASE_URL) {
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
