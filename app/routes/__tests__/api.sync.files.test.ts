import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "@vercel/blob";
import { handleUpload } from "@vercel/blob/client";
import { requireAuth } from "~/lib/database/auth-middleware";
import { getBookByIdForUser, updateBookBlobUrls } from "~/lib/database/book/book";
import {
  readLocalFile,
  useLocalFileStorage,
  writeLocalFile,
} from "~/lib/storage/local-file-storage.server";
import { loader } from "~/routes/api.sync.files.download";
import { action } from "~/routes/api.sync.files.upload";

vi.mock("@vercel/blob", () => ({ get: vi.fn() }));
vi.mock("@vercel/blob/client", () => ({ handleUpload: vi.fn() }));
vi.mock("~/lib/database/auth-middleware", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/database/book/book", () => ({
  getBookByIdForUser: vi.fn(),
  updateBookBlobUrls: vi.fn(),
}));
vi.mock("~/lib/storage/local-file-storage.server", () => ({
  useLocalFileStorage: vi.fn(),
  writeLocalFile: vi.fn(),
  readLocalFile: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireAuth);
const getBookMock = vi.mocked(getBookByIdForUser);
const updateUrlsMock = vi.mocked(updateBookBlobUrls);
const useLocalMock = vi.mocked(useLocalFileStorage);
const writeLocalMock = vi.mocked(writeLocalFile);
const readLocalMock = vi.mocked(readLocalFile);
const handleUploadMock = vi.mocked(handleUpload);
const getBlobMock = vi.mocked(get);

function uploadRequest(
  type = "file",
  contentType = "application/epub+zip",
  options: { bookId?: string; data?: Uint8Array; contentLength?: string } = {},
): Request {
  const bookId = options.bookId ?? "book-1";
  const headers = new Headers({ "Content-Type": contentType });
  const request = new Request(
    `http://localhost/api/sync/files/upload?bookId=${encodeURIComponent(bookId)}&type=${type}`,
    {
      method: "POST",
      headers,
      body: new Uint8Array(options.data ?? new TextEncoder().encode("book bytes")),
    },
  );
  if (options.contentLength) request.headers.set("Content-Length", options.contentLength);
  return request;
}

function downloadRequest(type = "file", bookId = "book-1"): Request {
  return new Request(
    `http://localhost/api/sync/files/download?bookId=${encodeURIComponent(bookId)}&type=${type}`,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DATABASE_URL", "postgres://test");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  useLocalMock.mockReturnValue(true);
  requireAuthMock.mockResolvedValue({ userId: "user-1" });
  getBookMock.mockResolvedValue({
    id: "book-1",
    userId: "user-1",
    fileBlobUrl: "/api/sync/files/download?bookId=book-1&type=file",
    coverBlobUrl: "/api/sync/files/download?bookId=book-1&type=cover",
  } as Awaited<ReturnType<typeof getBookByIdForUser>>);
  writeLocalMock.mockImplementation(async ({ bookId, type }) => ({
    url: `/api/sync/files/download?bookId=${encodeURIComponent(bookId)}&type=${type}`,
  }));
  readLocalMock.mockResolvedValue({
    data: new TextEncoder().encode("book bytes"),
    contentType: "application/epub+zip",
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("local authenticated file uploads", () => {
  it("stores an EPUB without a Vercel token and immediately updates the owned book", async () => {
    const response = await action({ request: uploadRequest() });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: "/api/sync/files/download?bookId=book-1&type=file",
    });
    expect(writeLocalMock).toHaveBeenCalledWith({
      userId: "user-1",
      bookId: "book-1",
      type: "file",
      data: new TextEncoder().encode("book bytes"),
      contentType: "application/epub+zip",
    });
    expect(updateUrlsMock).toHaveBeenCalledWith("book-1", {
      fileBlobUrl: "/api/sync/files/download?bookId=book-1&type=file",
    });
    expect(handleUploadMock).not.toHaveBeenCalled();
  });

  it.each([
    ["file", "application/pdf", "fileBlobUrl"],
    ["cover", "image/png", "coverBlobUrl"],
    ["cover", "image/webp", "coverBlobUrl"],
  ])("preserves the %s content type %s", async (type, contentType, field) => {
    const response = await action({ request: uploadRequest(type, contentType) });

    expect(response.status).toBe(200);
    expect(writeLocalMock).toHaveBeenCalledWith(expect.objectContaining({ type, contentType }));
    expect(updateUrlsMock).toHaveBeenCalledWith("book-1", {
      [field]: `/api/sync/files/download?bookId=book-1&type=${type}`,
    });
  });

  it("rejects unauthenticated uploads", async () => {
    requireAuthMock.mockRejectedValue(Response.json({ error: "auth_required" }, { status: 401 }));

    const response = await action({ request: uploadRequest() });

    expect(response.status).toBe(401);
    expect(writeLocalMock).not.toHaveBeenCalled();
  });

  it("does not write another user's book", async () => {
    getBookMock.mockResolvedValue(null);

    const response = await action({ request: uploadRequest() });

    expect(response.status).toBe(404);
    expect(getBookMock).toHaveBeenCalledWith("book-1", "user-1");
    expect(writeLocalMock).not.toHaveBeenCalled();
    expect(updateUrlsMock).not.toHaveBeenCalled();
  });

  it.each([
    ["file", "image/png"],
    ["cover", "application/pdf"],
    ["other", "application/epub+zip"],
  ])("rejects an invalid %s upload with MIME %s", async (type, contentType) => {
    const response = await action({ request: uploadRequest(type, contentType) });

    expect(response.status).toBe(400);
    expect(writeLocalMock).not.toHaveBeenCalled();
  });

  it.each([
    ["file", "application/epub+zip", String(100 * 1024 * 1024 + 1)],
    ["cover", "image/jpeg", String(5 * 1024 * 1024 + 1)],
  ])("rejects an oversized %s before writing", async (type, contentType, contentLength) => {
    const response = await action({ request: uploadRequest(type, contentType, { contentLength }) });

    expect(response.status).toBe(413);
    expect(writeLocalMock).not.toHaveBeenCalled();
  });

  it("keeps the Vercel token and webhook upload provider unchanged", async () => {
    useLocalMock.mockReturnValue(false);
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel-token");
    const payload = { type: "blob.generate-client-token", payload: {} };
    const providerResponse = { type: "blob.generate-client-token", clientToken: "signed-token" };
    handleUploadMock.mockResolvedValue(
      providerResponse as Awaited<ReturnType<typeof handleUpload>>,
    );
    const request = new Request("http://localhost/api/sync/files/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const response = await action({ request });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(providerResponse);
    expect(handleUploadMock).toHaveBeenCalledWith(
      expect.objectContaining({ token: "vercel-token", request, body: payload }),
    );
    expect(writeLocalMock).not.toHaveBeenCalled();
  });

  it("continues to require a Vercel token for the Vercel provider", async () => {
    useLocalMock.mockReturnValue(false);

    const response = await action({ request: uploadRequest() });

    expect(response.status).toBe(500);
    expect(handleUploadMock).not.toHaveBeenCalled();
  });

  it("signals a configured Vercel override to a development binary upload", async () => {
    useLocalMock.mockReturnValue(false);
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel-token");

    const response = await action({ request: uploadRequest() });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ backend: "vercel" });
    expect(handleUploadMock).not.toHaveBeenCalled();
    expect(writeLocalMock).not.toHaveBeenCalled();
  });
});

describe("local authenticated file downloads", () => {
  it("returns owned EPUB bytes without a Vercel token", async () => {
    const response = await loader({ request: downloadRequest() });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("book bytes");
    expect(response.headers.get("Content-Type")).toBe("application/epub+zip");
    expect(readLocalMock).toHaveBeenCalledWith({
      userId: "user-1",
      bookId: "book-1",
      type: "file",
    });
    expect(getBlobMock).not.toHaveBeenCalled();
  });

  it("preserves PDF content type and private immutable cover caching", async () => {
    readLocalMock
      .mockResolvedValueOnce({
        data: new TextEncoder().encode("pdf"),
        contentType: "application/pdf",
      })
      .mockResolvedValueOnce({ data: new TextEncoder().encode("png"), contentType: "image/png" });

    const file = await loader({ request: downloadRequest() });
    const cover = await loader({ request: downloadRequest("cover") });

    expect(file.headers.get("Content-Type")).toBe("application/pdf");
    expect(file.headers.has("Cache-Control")).toBe(false);
    expect(cover.headers.get("Content-Type")).toBe("image/png");
    expect(cover.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
  });

  it("preserves the thrown unauthorized response", async () => {
    requireAuthMock.mockRejectedValue(Response.json({ error: "auth_required" }, { status: 401 }));

    await expect(loader({ request: downloadRequest() })).rejects.toMatchObject({ status: 401 });
    expect(readLocalMock).not.toHaveBeenCalled();
  });

  it("does not read another user's book", async () => {
    getBookMock.mockResolvedValue(null);

    const response = await loader({ request: downloadRequest() });

    expect(response.status).toBe(404);
    expect(readLocalMock).not.toHaveBeenCalled();
  });

  it("returns not found for missing local file bytes", async () => {
    readLocalMock.mockResolvedValue(null);

    const response = await loader({ request: downloadRequest() });

    expect(response.status).toBe(404);
  });

  it("rejects unsupported file kinds", async () => {
    const response = await loader({ request: downloadRequest("other") });

    expect(response.status).toBe(400);
    expect(readLocalMock).not.toHaveBeenCalled();
  });

  it("continues to require a Vercel token for the Vercel provider", async () => {
    useLocalMock.mockReturnValue(false);

    const response = await loader({ request: downloadRequest() });

    expect(response.status).toBe(500);
    expect(getBlobMock).not.toHaveBeenCalled();
  });

  it("preserves authenticated private Vercel blob downloads", async () => {
    useLocalMock.mockReturnValue(false);
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel-token");
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("remote book"));
        controller.close();
      },
    });
    getBlobMock.mockResolvedValue({
      statusCode: 200,
      stream,
      blob: {
        contentType: "application/pdf",
        contentDisposition: 'attachment; filename="book.pdf"',
      },
    } as Awaited<ReturnType<typeof get>>);

    const response = await loader({ request: downloadRequest() });

    expect(await response.text()).toBe("remote book");
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="book.pdf"');
    expect(getBlobMock).toHaveBeenCalledWith("/api/sync/files/download?bookId=book-1&type=file", {
      access: "private",
      token: "vercel-token",
    });
    expect(readLocalMock).not.toHaveBeenCalled();
  });
});
