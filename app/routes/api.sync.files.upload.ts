import { requireAuth } from "~/lib/database/auth-middleware";
import { getBookByIdForUser, updateBookBlobUrls } from "~/lib/database/book/book";
import { getEnv } from "~/lib/env.server";
import { r2StorageUrl } from "~/lib/blob-url";

const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MiB
const MAX_COVER_BYTES = 5 * 1024 * 1024; // 5 MiB

const FILE_CONTENT_TYPES = ["application/epub+zip", "application/pdf"];
const COVER_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];
const COVER_CACHE_CONTROL_MAX_AGE = 31_536_000; // 1 year
type UploadType = "file" | "cover";

function normalizeContentType(value: string | null): string {
  return value?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function extensionForContentType(contentType: string): string {
  switch (contentType) {
    case "application/pdf":
      return "pdf";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/jpeg":
      return "jpg";
    default:
      return "epub";
  }
}

function pathSegment(value: string): string {
  return encodeURIComponent(value);
}

type UploadInput = {
  readonly body: Blob | ReadableStream;
  readonly contentType: string;
  readonly size: number | null;
};

async function readUploadInput(
  request: Request,
  requestContentType: string,
): Promise<Response | UploadInput> {
  if (requestContentType === "multipart/form-data") {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json({ error: "Invalid multipart upload" }, { status: 400 });
    }
    const value = form.get("file") ?? form.get("blob");
    if (!(value instanceof Blob)) {
      return Response.json(
        { error: "Multipart upload must include a file field" },
        { status: 400 },
      );
    }
    return { body: value, contentType: normalizeContentType(value.type), size: value.size };
  }

  if (!request.body) {
    return Response.json({ error: "Upload body is required" }, { status: 400 });
  }

  return { body: request.body, contentType: requestContentType, size: null };
}

/**
 * POST /api/sync/files/upload
 *
 * Authenticated first-party upload endpoint. The browser posts file bytes here;
 * the Worker writes them to the private R2 bucket and stores the returned
 * internal `r2://...` reference on the book row.
 */
export async function action({ request }: { request: Request }) {
  const env = getEnv();
  if (!env.DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }

  let userId: string;
  try {
    ({ userId } = await requireAuth(request));
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const bookId = url.searchParams.get("bookId");
  const type = url.searchParams.get("type") as UploadType | null;

  if (!bookId) {
    return Response.json({ error: "bookId is required" }, { status: 400 });
  }
  if (type !== "file" && type !== "cover") {
    return Response.json(
      { error: 'Invalid type parameter. Must be "file" or "cover".' },
      { status: 400 },
    );
  }

  const bucket = type === "cover" ? env.R2_COVERS : env.R2_FILES;
  if (!bucket) {
    return Response.json({ error: "R2 storage is not configured" }, { status: 500 });
  }

  const requestContentType = normalizeContentType(request.headers.get("content-type"));
  const declaredLengthHeader = request.headers.get("content-length");
  const declaredLength = declaredLengthHeader ? Number(declaredLengthHeader) : null;
  const maxBytes = type === "cover" ? MAX_COVER_BYTES : MAX_FILE_BYTES;
  if (declaredLength !== null && Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return Response.json({ error: "Upload exceeds maximum size" }, { status: 413 });
  }

  try {
    const book = await getBookByIdForUser(bookId, userId);
    if (!book) {
      return Response.json({ error: "Book not found" }, { status: 404 });
    }

    const upload = await readUploadInput(request, requestContentType);
    if (upload instanceof Response) return upload;

    const uploadSize = upload.size ?? declaredLength;
    if (uploadSize === 0) {
      return Response.json({ error: "Upload body is required" }, { status: 400 });
    }
    if (uploadSize !== null && Number.isFinite(uploadSize) && uploadSize > maxBytes) {
      return Response.json({ error: "Upload exceeds maximum size" }, { status: 413 });
    }

    const contentType = upload.contentType;
    const allowedTypes = type === "cover" ? COVER_CONTENT_TYPES : FILE_CONTENT_TYPES;
    if (!allowedTypes.includes(contentType)) {
      return Response.json({ error: "Unsupported content type" }, { status: 415 });
    }

    const extension = extensionForContentType(contentType);
    const fileName = type === "cover" ? `cover.${extension}` : `book.${extension}`;
    const key = `${type === "cover" ? "covers" : "books"}/${pathSegment(userId)}/${pathSegment(bookId)}/${fileName}`;
    const storageUrl = r2StorageUrl(type, key);

    await bucket.put(key, upload.body, {
      httpMetadata: {
        contentType,
        contentDisposition: type === "cover" ? "inline" : `attachment; filename="${fileName}"`,
        ...(type === "cover"
          ? { cacheControl: `private, max-age=${COVER_CACHE_CONTROL_MAX_AGE}, immutable` }
          : {}),
      },
    });

    if (type === "cover") {
      await updateBookBlobUrls(bookId, { coverBlobUrl: storageUrl });
    } else {
      await updateBookBlobUrls(bookId, { fileBlobUrl: storageUrl });
    }

    return Response.json({ key, url: storageUrl });
  } catch (error) {
    console.error("Sync file upload failed", error);
    return Response.json({ error: "Upload failed" }, { status: 500 });
  }
}
