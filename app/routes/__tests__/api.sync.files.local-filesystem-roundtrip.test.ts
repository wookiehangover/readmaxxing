import { Blob as NodeBlob } from "node:buffer";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get as getVercelBlob } from "@vercel/blob";
import { handleUpload, upload as uploadToVercel } from "@vercel/blob/client";
import { clear, createStore, get, set } from "idb-keyval";
import { requireAuth } from "~/lib/database/auth-middleware";
import { getBookByIdForUser, updateBookBlobUrls, type BookRow } from "~/lib/database/book/book";
import { uploadFile, uploadPendingFiles } from "~/lib/sync/file-uploads";
import { getBookDataStore, getBookStore } from "~/lib/sync/stores";
import { loader as downloadFile } from "~/routes/api.sync.files.download";
import { action as uploadFileRoute } from "~/routes/api.sync.files.upload";

vi.mock("@vercel/blob", () => ({ get: vi.fn() }));
vi.mock("@vercel/blob/client", () => ({ handleUpload: vi.fn(), upload: vi.fn() }));
vi.mock("~/lib/database/auth-middleware", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/database/book/book", () => ({
  getBookByIdForUser: vi.fn(),
  updateBookBlobUrls: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireAuth);
const getBookMock = vi.mocked(getBookByIdForUser);
const updateBookUrlsMock = vi.mocked(updateBookBlobUrls);
const handleUploadMock = vi.mocked(handleUpload);
const vercelUploadMock = vi.mocked(uploadToVercel);
const vercelDownloadMock = vi.mocked(getVercelBlob);
const originalBlob = globalThis.Blob;
const changeLogStore = createStore("ebook-reader-changelog", "changes");
const books = new Map<string, BookRow>();

let dataRoot: string;
let authenticatedUser: string;

function createOwnedBook(bookId: string, userId = "owner-1", format = "epub"): BookRow {
  const book: BookRow = {
    id: bookId,
    userId,
    title: "Filesystem integration book",
    author: "Local reader",
    format,
    coverBlobUrl: null,
    fileBlobUrl: null,
    fileHash: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
  };
  books.set(bookId, book);
  return book;
}

function requestFor(
  pathname: "upload" | "download",
  bookId: string,
  type = "file",
  options: { contentType?: string; body?: BodyInit; contentLength?: number; userId?: string } = {},
): Request {
  const headers = new Headers({ "x-test-user": options.userId ?? authenticatedUser });
  if (options.contentType) headers.set("Content-Type", options.contentType);

  const request = new Request(
    `http://localhost/api/sync/files/${pathname}?bookId=${encodeURIComponent(bookId)}&type=${type}`,
    {
      method: pathname === "upload" ? "POST" : "GET",
      headers,
      ...(pathname === "upload" ? { body: options.body ?? "file contents" } : {}),
    },
  );
  if (options.contentLength !== undefined) {
    request.headers.set("Content-Length", String(options.contentLength));
  }
  return request;
}

function installRouteBackedFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
    const headers = new Headers(init?.headers);
    headers.set("x-test-user", authenticatedUser);
    const body =
      init?.body instanceof NodeBlob ? new Uint8Array(await init.body.arrayBuffer()) : init?.body;
    const request = new Request(url, { ...init, headers, ...(body ? { body } : {}) });

    if (url.pathname === "/api/sync/files/upload") {
      return uploadFileRoute({ request });
    }
    if (url.pathname === "/api/sync/files/download") {
      return downloadFile({ request });
    }

    throw new Error(`Unexpected external request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(async () => {
  vi.resetAllMocks();
  books.clear();
  authenticatedUser = "owner-1";
  dataRoot = await mkdtemp(join(tmpdir(), "readmax-local-filesystem-"));
  globalThis.Blob = NodeBlob as typeof Blob;
  vi.spyOn(process, "cwd").mockReturnValue(dataRoot);
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("MODE", "development");
  vi.stubEnv("DATABASE_URL", "postgres://filesystem-integration");
  vi.stubEnv("BLOB_STORAGE_BACKEND", "");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("VERCEL_BLOB_CALLBACK_URL", "");

  requireAuthMock.mockImplementation(async (request) => {
    const userId = request.headers.get("x-test-user");
    if (!userId) throw Response.json({ error: "auth_required" }, { status: 401 });
    return { userId };
  });
  getBookMock.mockImplementation(async (bookId, userId) => {
    const book = books.get(bookId);
    return book?.userId === userId ? book : null;
  });
  updateBookUrlsMock.mockImplementation(async (bookId, urls) => {
    const book = books.get(bookId);
    if (book) Object.assign(book, urls);
    return book ?? null;
  });

  await Promise.all([clear(getBookStore()), clear(getBookDataStore()), clear(changeLogStore)]);
});

afterEach(async () => {
  globalThis.Blob = originalBlob;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(dataRoot, { recursive: true, force: true });
});

describe("authenticated local filesystem upload and download integration", () => {
  it.each([
    ["file", "application/epub+zip", "epub bytes"],
    ["file", "application/pdf", "pdf bytes"],
    ["cover", "image/jpeg", "jpeg bytes"],
    ["cover", "image/png", "png bytes"],
    ["cover", "image/webp", "webp bytes"],
  ] as const)(
    "round-trips a %s with MIME %s through the real client, routes, and disk",
    async (type, contentType, contents) => {
      const book = createOwnedBook("roundtrip-book");
      const fetchMock = installRouteBackedFetch();

      const url = await uploadFile(
        { userId: authenticatedUser, uploadRetryState: new Map() },
        book.id,
        new Blob([contents], { type: contentType }),
        type,
      );

      const expectedUrl = `/api/sync/files/download?bookId=${book.id}&type=${type}`;
      expect(url).toBe(expectedUrl);
      expect(type === "file" ? book.fileBlobUrl : book.coverBlobUrl).toBe(expectedUrl);
      expect(
        await readFile(join(dataRoot, "data", "blob", book.userId, book.id, type), "utf8"),
      ).toBe(contents);
      expect(
        JSON.parse(
          await readFile(
            join(dataRoot, "data", "blob", book.userId, book.id, `${type}.json`),
            "utf8",
          ),
        ),
      ).toEqual({ contentType });

      const response = await fetch(expectedUrl);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(contents);
      expect(response.headers.get("Content-Type")).toBe(contentType);
      expect(response.headers.get("Cache-Control")).toBe(
        type === "cover" ? "private, max-age=31536000, immutable" : null,
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(vercelUploadMock).not.toHaveBeenCalled();
      expect(vercelDownloadMock).not.toHaveBeenCalled();
      expect(handleUploadMock).not.toHaveBeenCalled();
      expect(process.env.BLOB_READ_WRITE_TOKEN).toBe("");
      expect(process.env.VERCEL_BLOB_CALLBACK_URL).toBe("");
    },
  );

  it("persists owner-scoped book and cover URLs in both the database and client metadata", async () => {
    const book = createOwnedBook("metadata-book", authenticatedUser, "pdf");
    installRouteBackedFetch();
    await set(
      book.id,
      {
        id: book.id,
        title: book.title,
        format: "pdf",
        coverImage: new Blob(["cover image"], { type: "image/webp" }),
        hasLocalFile: true,
        updatedAt: 1,
      },
      getBookStore(),
    );
    await set(book.id, new TextEncoder().encode("pdf document").buffer, getBookDataStore());

    await uploadPendingFiles({ userId: authenticatedUser, uploadRetryState: new Map() });

    const fileUrl = `/api/sync/files/download?bookId=${book.id}&type=file`;
    const coverUrl = `/api/sync/files/download?bookId=${book.id}&type=cover`;
    expect(book).toMatchObject({ fileBlobUrl: fileUrl, coverBlobUrl: coverUrl });
    expect(await get<Record<string, unknown>>(book.id, getBookStore())).toMatchObject({
      remoteFileUrl: fileUrl,
      remoteCoverUrl: coverUrl,
    });
    expect(updateBookUrlsMock).toHaveBeenNthCalledWith(1, book.id, { fileBlobUrl: fileUrl });
    expect(updateBookUrlsMock).toHaveBeenNthCalledWith(2, book.id, { coverBlobUrl: coverUrl });
    expect(await (await fetch(fileUrl)).text()).toBe("pdf document");
    expect(await (await fetch(coverUrl)).text()).toBe("cover image");
  });

  it("denies another authenticated user both upload and download without changing owner bytes", async () => {
    const book = createOwnedBook("private-book");
    const ownerUpload = await uploadFileRoute({
      request: requestFor("upload", book.id, "file", {
        contentType: "application/epub+zip",
        body: "private bytes",
      }),
    });
    expect(ownerUpload.status).toBe(200);

    authenticatedUser = "intruder-2";
    const intruderUpload = await uploadFileRoute({
      request: requestFor("upload", book.id, "file", {
        contentType: "application/epub+zip",
        body: "replacement bytes",
      }),
    });
    const intruderDownload = await downloadFile({ request: requestFor("download", book.id) });

    expect(intruderUpload.status).toBe(404);
    expect(intruderDownload.status).toBe(404);
    expect(
      await readFile(join(dataRoot, "data", "blob", book.userId, book.id, "file"), "utf8"),
    ).toBe("private bytes");
    await expect(access(join(dataRoot, "data", "blob", authenticatedUser))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("requires authentication before filesystem upload or download", async () => {
    const book = createOwnedBook("authenticated-book");
    const request = requestFor("upload", book.id, "file", {
      contentType: "application/epub+zip",
      userId: "",
    });

    expect((await uploadFileRoute({ request })).status).toBe(401);
    await expect(
      downloadFile({ request: requestFor("download", book.id, "file", { userId: "" }) }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(access(join(dataRoot, "data", "blob"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["file", "image/png"],
    ["cover", "application/pdf"],
    ["other", "application/epub+zip"],
  ])("rejects invalid local %s uploads with MIME %s before writing", async (type, contentType) => {
    const book = createOwnedBook("invalid-upload-book");

    const response = await uploadFileRoute({
      request: requestFor("upload", book.id, type, { contentType }),
    });

    expect(response.status).toBe(400);
    expect(updateBookUrlsMock).not.toHaveBeenCalled();
    await expect(access(join(dataRoot, "data", "blob"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["file", "application/epub+zip", 100 * 1024 * 1024 + 1],
    ["cover", "image/jpeg", 5 * 1024 * 1024 + 1],
  ])(
    "rejects oversized %s content-length declarations without writing",
    async (type, contentType, contentLength) => {
      const book = createOwnedBook("oversized-book");

      const response = await uploadFileRoute({
        request: requestFor("upload", book.id, type, { contentType, contentLength }),
      });

      expect(response.status).toBe(413);
      expect(updateBookUrlsMock).not.toHaveBeenCalled();
      await expect(access(join(dataRoot, "data", "blob"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it("rejects an oversized cover body when its content-length header is absent", async () => {
    const book = createOwnedBook("oversized-cover-book");

    const response = await uploadFileRoute({
      request: requestFor("upload", book.id, "cover", {
        contentType: "image/png",
        body: new Uint8Array(5 * 1024 * 1024 + 1),
      }),
    });

    expect(response.status).toBe(413);
    expect(book.coverBlobUrl).toBeNull();
    await expect(access(join(dataRoot, "data", "blob"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["../outside", "nested/book", "..", "book%2Fescape"])(
    "rejects traversal-like owned book identifier %s without escaping the data root",
    async (bookId) => {
      createOwnedBook(bookId);

      const response = await uploadFileRoute({
        request: requestFor("upload", bookId, "file", { contentType: "application/epub+zip" }),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid local file storage identifier" });
      expect(updateBookUrlsMock).not.toHaveBeenCalled();
      await expect(access(join(dataRoot, "data", "blob"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it("returns not found when persisted database metadata points to missing disk bytes", async () => {
    const book = createOwnedBook("missing-file-book");
    book.fileBlobUrl = `/api/sync/files/download?bookId=${book.id}&type=file`;

    const response = await downloadFile({ request: requestFor("download", book.id) });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "No file uploaded for this book" });
    expect(vercelDownloadMock).not.toHaveBeenCalled();
  });

  it("reopens existing disk bytes through newly loaded server modules after a simulated restart", async () => {
    const book = createOwnedBook("restart-book");
    const uploadResponse = await uploadFileRoute({
      request: requestFor("upload", book.id, "file", {
        contentType: "application/pdf",
        body: "bytes surviving restart",
      }),
    });
    expect(uploadResponse.status).toBe(200);
    const persistedUrl = book.fileBlobUrl;

    vi.resetModules();
    const { loader: restartedDownloadFile } = await import("~/routes/api.sync.files.download");
    const response = await restartedDownloadFile({ request: requestFor("download", book.id) });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("bytes surviving restart");
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(book.fileBlobUrl).toBe(persistedUrl);
    expect(vercelDownloadMock).not.toHaveBeenCalled();
  });

  it("honors an explicit local backend without a Vercel token in production NODE_ENV", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BLOB_STORAGE_BACKEND", "local");
    const book = createOwnedBook("explicit-local-book");

    const response = await uploadFileRoute({
      request: requestFor("upload", book.id, "file", { contentType: "application/epub+zip" }),
    });

    expect(response.status).toBe(200);
    expect(
      await readFile(join(dataRoot, "data", "blob", book.userId, book.id, "file"), "utf8"),
    ).toBe("file contents");
    expect(handleUploadMock).not.toHaveBeenCalled();
  });

  it("routes an explicit Vercel development override through the existing Blob SDK", async () => {
    vi.stubEnv("BLOB_STORAGE_BACKEND", "vercel");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel-test-token");
    const book = createOwnedBook("vercel-override-book");
    const fetchMock = installRouteBackedFetch();
    vercelUploadMock.mockResolvedValue({ url: "https://blob.example/override.epub" } as Awaited<
      ReturnType<typeof uploadToVercel>
    >);

    const result = await uploadFile(
      { userId: authenticatedUser, uploadRetryState: new Map() },
      book.id,
      new Blob(["vercel bytes"], { type: "application/epub+zip" }),
      "file",
    );

    expect(result).toBe("https://blob.example/override.epub");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vercelUploadMock).toHaveBeenCalledWith(
      `books/${authenticatedUser}/${book.id}/book.epub`,
      expect.any(Blob),
      expect.objectContaining({ access: "private", handleUploadUrl: "/api/sync/files/upload" }),
    );
    expect(updateBookUrlsMock).not.toHaveBeenCalled();
    await expect(access(join(dataRoot, "data", "blob"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves production Vercel token handshakes and authenticated private downloads", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MODE", "production");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel-test-token");
    const book = createOwnedBook("production-book");
    book.fileBlobUrl = "https://blob.example/production.epub";
    const handshake = { type: "blob.generate-client-token", clientToken: "signed-token" };
    handleUploadMock.mockResolvedValue(handshake as Awaited<ReturnType<typeof handleUpload>>);

    const uploadResponse = await uploadFileRoute({
      request: new Request("http://localhost/api/sync/files/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-user": authenticatedUser },
        body: JSON.stringify({ type: "blob.generate-client-token", payload: {} }),
      }),
    });
    expect(uploadResponse.status).toBe(200);
    expect(await uploadResponse.json()).toEqual(handshake);
    expect(handleUploadMock).toHaveBeenCalledWith(
      expect.objectContaining({ token: "vercel-test-token" }),
    );

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("production bytes"));
        controller.close();
      },
    });
    vercelDownloadMock.mockResolvedValue({
      statusCode: 200,
      stream,
      blob: {
        contentType: "application/epub+zip",
        contentDisposition: 'attachment; filename="book.epub"',
      },
    } as Awaited<ReturnType<typeof getVercelBlob>>);

    const downloadResponse = await downloadFile({ request: requestFor("download", book.id) });
    expect(await downloadResponse.text()).toBe("production bytes");
    expect(vercelDownloadMock).toHaveBeenCalledWith(book.fileBlobUrl, {
      access: "private",
      token: "vercel-test-token",
    });
    await expect(access(join(dataRoot, "data", "blob"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
