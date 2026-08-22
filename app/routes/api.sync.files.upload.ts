import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireAuth } from "~/lib/database/auth-middleware";
import { getBookByIdForUser, updateBookBlobUrls } from "~/lib/database/book/book";
import {
  useLocalFileStorage,
  writeLocalFile,
  type LocalFileKind,
} from "~/lib/storage/local-file-storage.server";

const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MiB
const MAX_COVER_BYTES = 5 * 1024 * 1024; // 5 MiB

const FILE_CONTENT_TYPES = ["application/epub+zip", "application/pdf"];
const COVER_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];
const COVER_CACHE_CONTROL_MAX_AGE = 31_536_000; // 1 year

interface ClientPayload {
  bookId: string;
  type: LocalFileKind;
}

interface TokenPayload {
  bookId: string;
  type: LocalFileKind;
}

async function uploadLocalFile(request: Request, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const bookId = url.searchParams.get("bookId");
  const type = url.searchParams.get("type");

  if (!bookId) {
    return Response.json({ error: "bookId is required" }, { status: 400 });
  }
  if (type !== "file" && type !== "cover") {
    return Response.json(
      { error: 'Invalid type parameter. Must be "file" or "cover".' },
      {
        status: 400,
      },
    );
  }

  const contentType = request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase();
  const allowedContentTypes = type === "cover" ? COVER_CONTENT_TYPES : FILE_CONTENT_TYPES;
  if (!contentType || !allowedContentTypes.includes(contentType)) {
    return Response.json({ error: "Invalid upload content type" }, { status: 400 });
  }

  const maximumSize = type === "cover" ? MAX_COVER_BYTES : MAX_FILE_BYTES;
  const contentLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > maximumSize) {
    return Response.json({ error: "Upload exceeds maximum file size" }, { status: 413 });
  }

  const book = await getBookByIdForUser(bookId, userId);
  if (!book) {
    return Response.json({ error: "Book not found" }, { status: 404 });
  }

  const data = new Uint8Array(await request.arrayBuffer());
  if (data.byteLength > maximumSize) {
    return Response.json({ error: "Upload exceeds maximum file size" }, { status: 413 });
  }

  try {
    const result = await writeLocalFile({ userId, bookId, type, data, contentType });
    await updateBookBlobUrls(
      bookId,
      type === "cover" ? { coverBlobUrl: result.url } : { fileBlobUrl: result.url },
    );
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 400 },
    );
  }
}

function parseClientPayload(raw: string | null): ClientPayload {
  if (!raw) {
    throw new Error("Missing clientPayload");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid clientPayload JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid clientPayload");
  }
  const { bookId, type } = parsed as { bookId?: unknown; type?: unknown };
  if (typeof bookId !== "string" || bookId.length === 0) {
    throw new Error("Invalid clientPayload: bookId");
  }
  if (type !== "file" && type !== "cover") {
    throw new Error("Invalid clientPayload: type");
  }
  return { bookId, type };
}

function parseTokenPayload(raw: string | null | undefined): TokenPayload {
  if (!raw) {
    throw new Error("Missing tokenPayload");
  }
  const parsed = JSON.parse(raw) as { bookId?: unknown; type?: unknown };
  if (typeof parsed.bookId !== "string" || parsed.bookId.length === 0) {
    throw new Error("Invalid tokenPayload: bookId");
  }
  if (parsed.type !== "file" && parsed.type !== "cover") {
    throw new Error("Invalid tokenPayload: type");
  }
  return { bookId: parsed.bookId, type: parsed.type };
}

/**
 * POST /api/sync/files/upload
 *
 * Vercel Blob client-upload token handler.
 *
 * Accepts a JSON `HandleUploadBody` — either a token request from the browser
 * or an `onUploadCompleted` webhook from Vercel Blob. Returns the signed
 * client token (for the former) or `{ response: "ok" }` (for the latter).
 */
export async function action({ request }: { request: Request }) {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }

  const localStorage = useLocalFileStorage();
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!localStorage && !token) {
    return Response.json({ error: "Blob storage is not configured" }, { status: 500 });
  }

  let userId: string;
  try {
    ({ userId } = await requireAuth(request));
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (localStorage) return uploadLocalFile(request, userId);

  if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
    return Response.json({ backend: "vercel" }, { status: 409 });
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      token,
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const { bookId, type } = parseClientPayload(clientPayload);

        const folder = type === "cover" ? "covers" : "books";
        const expectedPrefix = `${folder}/${userId}/${bookId}/`;
        if (!pathname.startsWith(expectedPrefix)) {
          throw new Error("Invalid upload pathname");
        }

        const book = await getBookByIdForUser(bookId, userId);
        if (!book) {
          throw new Error("Book not found or not owned by user");
        }

        return {
          allowedContentTypes: type === "cover" ? COVER_CONTENT_TYPES : FILE_CONTENT_TYPES,
          maximumSizeInBytes: type === "cover" ? MAX_COVER_BYTES : MAX_FILE_BYTES,
          addRandomSuffix: false,
          allowOverwrite: true,
          ...(type === "cover" ? { cacheControlMaxAge: COVER_CACHE_CONTROL_MAX_AGE } : {}),
          tokenPayload: JSON.stringify({ bookId, type } satisfies TokenPayload),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const { bookId, type } = parseTokenPayload(tokenPayload);
        if (type === "cover") {
          await updateBookBlobUrls(bookId, { coverBlobUrl: blob.url });
        } else {
          await updateBookBlobUrls(bookId, { fileBlobUrl: blob.url });
        }
      },
    });

    return Response.json(jsonResponse);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 400 },
    );
  }
}
