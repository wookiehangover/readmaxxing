import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { upload } from "@vercel/blob/client";
import { clear, createStore, get, set } from "idb-keyval";
import { uploadFile, uploadPendingFiles } from "../file-uploads";

vi.mock("@vercel/blob/client", () => ({ upload: vi.fn() }));
vi.mock("../change-log", () => ({ recordChange: vi.fn(async () => undefined) }));

const uploadMock = vi.mocked(upload);
const originalBlob = globalThis.Blob;
const bookStore = createStore("ebook-reader-db", "books");
const bookDataStore = createStore("ebook-reader-book-data", "book-data");

beforeEach(async () => {
  globalThis.Blob = NodeBlob as typeof Blob;
  vi.clearAllMocks();
  vi.stubEnv("MODE", "development");
  await Promise.all([clear(bookStore), clear(bookDataStore)]);
});

afterEach(() => {
  globalThis.Blob = originalBlob;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("development file uploads", () => {
  it("uploads EPUB bytes directly to the authenticated upload route", async () => {
    const url = "/api/sync/files/download?bookId=book-1&type=file";
    const fetchMock = vi.fn(async () => Response.json({ url }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadFile(
      { userId: "user-1", uploadRetryState: new Map() },
      "book-1",
      new TextEncoder().encode("epub bytes").buffer,
      "file",
    );

    expect(result).toBe(url);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sync/files/upload?bookId=book-1&type=file",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/epub+zip" },
      }),
    );
  });

  it("preserves PDF and PNG cover MIME types", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ url: "/local/file" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const context = { userId: "user-1", uploadRetryState: new Map() };

    await uploadFile(context, "book-1", new Blob(["pdf"], { type: "application/pdf" }), "file");
    await uploadFile(context, "book-1", new Blob(["png"], { type: "image/png" }), "cover");

    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ headers: { "Content-Type": "application/pdf" } }),
    );
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ headers: { "Content-Type": "image/png" } }),
    );
  });

  it("uses stored PDF metadata and preserves WebP covers during pending-file recovery", async () => {
    await set(
      "book-pdf",
      {
        id: "book-pdf",
        title: "PDF",
        format: "pdf",
        coverImage: new Blob(["cover"], { type: "image/webp" }),
        hasLocalFile: true,
        updatedAt: 1,
      },
      bookStore,
    );
    await set("book-pdf", new TextEncoder().encode("pdf bytes").buffer, bookDataStore);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      return Response.json({
        url: `/api/sync/files/download?bookId=book-pdf&type=${url.searchParams.get("type")}`,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await uploadPendingFiles({ userId: "user-1", uploadRetryState: new Map() });

    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ headers: { "Content-Type": "application/pdf" } }),
    );
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ headers: { "Content-Type": "image/webp" } }),
    );
    expect(await get<Record<string, unknown>>("book-pdf", bookStore)).toEqual(
      expect.objectContaining({
        remoteFileUrl: "/api/sync/files/download?bookId=book-pdf&type=file",
        remoteCoverUrl: "/api/sync/files/download?bookId=book-pdf&type=cover",
      }),
    );
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("expires authentication only for an actual unauthorized upload response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "Unauthorized" }, { status: 401 })),
    );
    const onAuthExpired = vi.fn();

    const result = await uploadFile(
      { userId: "user-1", uploadRetryState: new Map(), onAuthExpired },
      "book-1",
      new TextEncoder().encode("epub bytes").buffer,
      "file",
    );

    expect(result).toBeNull();
    expect(onAuthExpired).toHaveBeenCalledOnce();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("does not expire authentication when the server-owned book is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "Book not found" }, { status: 404 })),
    );
    const onAuthExpired = vi.fn();

    const result = await uploadFile(
      { userId: "user-1", uploadRetryState: new Map(), onAuthExpired },
      "book-1",
      new TextEncoder().encode("epub bytes").buffer,
      "file",
    );

    expect(result).toBeNull();
    expect(onAuthExpired).not.toHaveBeenCalled();
  });

  it("honors an explicit Vercel provider override during development", async () => {
    const fetchMock = vi.fn(async () => Response.json({ backend: "vercel" }, { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    uploadMock.mockResolvedValue({ url: "https://blob.example/book.epub" } as Awaited<
      ReturnType<typeof upload>
    >);

    const result = await uploadFile(
      { userId: "user-1", uploadRetryState: new Map() },
      "book-1",
      new TextEncoder().encode("epub bytes").buffer,
      "file",
    );

    expect(result).toBe("https://blob.example/book.epub");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(uploadMock).toHaveBeenCalledOnce();
  });

  it("uses the Vercel client in production", async () => {
    vi.stubEnv("MODE", "production");
    const fetchMock = vi.fn(async () => Response.json({ backend: "vercel" }));
    vi.stubGlobal("fetch", fetchMock);
    uploadMock.mockResolvedValue({ url: "https://blob.example/book.epub" } as Awaited<
      ReturnType<typeof upload>
    >);

    const result = await uploadFile(
      { userId: "user-1", uploadRetryState: new Map() },
      "book-1",
      new TextEncoder().encode("epub bytes").buffer,
      "file",
    );

    expect(result).toBe("https://blob.example/book.epub");
    expect(uploadMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/sync/files/upload", {
      method: "POST",
      credentials: "include",
      headers: { "X-Readmax-Storage-Backend": "negotiate" },
    });
  });
});
