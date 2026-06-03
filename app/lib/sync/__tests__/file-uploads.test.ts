import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clear, createStore, get, set } from "idb-keyval";
import { upload } from "@vercel/blob/client";
import { recordChange } from "../change-log";
import { reloadBookFiles, uploadPendingFiles } from "../file-uploads";
import { uploadRetryKey, type UploadRetryEntry } from "../upload-retry";

vi.mock("@vercel/blob/client", () => ({
  upload: vi.fn(),
}));

vi.mock("../change-log", () => ({
  recordChange: vi.fn(async () => undefined),
}));

const uploadMock = vi.mocked(upload);
const recordChangeMock = vi.mocked(recordChange);

const bookStore = createStore("ebook-reader-db", "books");
const bookDataStore = createStore("ebook-reader-book-data", "book-data");

async function seedPendingBook(bookId: string): Promise<void> {
  await set(
    bookId,
    {
      id: bookId,
      title: bookId,
      coverImage: new Blob([`cover:${bookId}`], { type: "image/jpeg" }),
      hasLocalFile: true,
      updatedAt: 1,
    },
    bookStore,
  );
  await set(bookId, new TextEncoder().encode(`file:${bookId}`).buffer, bookDataStore);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await Promise.all([clear(bookStore), clear(bookDataStore)]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadPendingFiles", () => {
  it("uploads local books missing remote URLs without touching already-remote books", async () => {
    await seedPendingBook("book-missing");
    await set(
      "book-remote",
      {
        id: "book-remote",
        title: "remote",
        coverImage: new Blob(["cover:remote"], { type: "image/jpeg" }),
        remoteFileUrl: "blob://existing-file",
        remoteCoverUrl: "blob://existing-cover",
        hasLocalFile: true,
        updatedAt: 1,
      },
      bookStore,
    );
    await set("book-remote", new TextEncoder().encode("file:remote").buffer, bookDataStore);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    uploadMock.mockImplementation(async (pathname) => ({ url: `blob://${pathname}` }));

    await uploadPendingFiles({ userId: "user-1", uploadRetryState: new Map() });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadMock.mock.calls.map(([pathname]) => pathname)).toEqual([
      "books/user-1/book-missing/book.epub",
      "covers/user-1/book-missing/cover.jpg",
    ]);
    const book = await get<Record<string, unknown>>("book-missing", bookStore);
    expect(book?.remoteFileUrl).toBe("blob://books/user-1/book-missing/book.epub");
    expect(book?.remoteCoverUrl).toBe("blob://covers/user-1/book-missing/cover.jpg");
    expect(recordChangeMock).toHaveBeenCalledTimes(2);
  });

  it("continues through the batch and uploads covers when one file upload rejects", async () => {
    await Promise.all([seedPendingBook("book-1"), seedPendingBook("book-2")]);
    uploadMock.mockImplementation(async (pathname) => {
      if (pathname === "books/user-1/book-1/book.epub") {
        return Object.defineProperty({}, "url", {
          get() {
            throw new Error("bad file result");
          },
        }) as { url: string };
      }
      return { url: `blob://${pathname}` };
    });

    await uploadPendingFiles({ userId: "user-1", uploadRetryState: new Map() });

    expect(uploadMock.mock.calls.map(([pathname]) => pathname)).toEqual([
      "books/user-1/book-1/book.epub",
      "covers/user-1/book-1/cover.jpg",
      "books/user-1/book-2/book.epub",
      "covers/user-1/book-2/cover.jpg",
    ]);
    const book1 = await get<Record<string, unknown>>("book-1", bookStore);
    const book2 = await get<Record<string, unknown>>("book-2", bookStore);
    expect(book1?.remoteFileUrl).toBeUndefined();
    expect(book1?.remoteCoverUrl).toBe("blob://covers/user-1/book-1/cover.jpg");
    expect(book2?.remoteFileUrl).toBe("blob://books/user-1/book-2/book.epub");
    expect(book2?.remoteCoverUrl).toBe("blob://covers/user-1/book-2/cover.jpg");
    expect(recordChangeMock).toHaveBeenCalledTimes(3);
  });

  it("reuploads stale remote URLs during verification when local blobs still exist", async () => {
    await set(
      "book-stale",
      {
        id: "book-stale",
        title: "stale",
        coverImage: new Blob(["cover:stale"], { type: "image/jpeg" }),
        remoteFileUrl: "blob://missing-file",
        remoteCoverUrl: "blob://missing-cover",
        hasLocalFile: true,
        updatedAt: 1,
      },
      bookStore,
    );
    await set("book-stale", new TextEncoder().encode("file:stale").buffer, bookDataStore);
    const fetchMock = vi.fn(async () => new Response("missing", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    uploadMock.mockImplementation(async (pathname) => ({ url: `blob://${pathname}` }));

    await uploadPendingFiles(
      { userId: "user-1", uploadRetryState: new Map() },
      { verifyExistingRemoteUrls: true },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(uploadMock.mock.calls.map(([pathname]) => pathname)).toEqual([
      "books/user-1/book-stale/book.epub",
      "covers/user-1/book-stale/cover.jpg",
    ]);
    const book = await get<Record<string, unknown>>("book-stale", bookStore);
    expect(book?.remoteFileUrl).toBe("blob://books/user-1/book-stale/book.epub");
    expect(book?.remoteCoverUrl).toBe("blob://covers/user-1/book-stale/cover.jpg");
    expect(recordChangeMock).toHaveBeenCalledTimes(2);
  });

  it("keeps backoff skips isolated by book and upload type", async () => {
    await Promise.all([seedPendingBook("book-1"), seedPendingBook("book-2")]);
    uploadMock.mockImplementation(async (pathname) => ({ url: `blob://${pathname}` }));
    const uploadRetryState = new Map<string, UploadRetryEntry>();
    uploadRetryState.set(uploadRetryKey("book-1", "file"), {
      attempts: 1,
      nextRetryAt: Date.now() + 60_000,
    });

    await uploadPendingFiles({ userId: "user-1", uploadRetryState });

    expect(uploadMock.mock.calls.map(([pathname]) => pathname)).toEqual([
      "covers/user-1/book-1/cover.jpg",
      "books/user-1/book-2/book.epub",
      "covers/user-1/book-2/cover.jpg",
    ]);
    const book1 = await get<Record<string, unknown>>("book-1", bookStore);
    const book2 = await get<Record<string, unknown>>("book-2", bookStore);
    expect(book1?.remoteFileUrl).toBeUndefined();
    expect(book1?.remoteCoverUrl).toBe("blob://covers/user-1/book-1/cover.jpg");
    expect(book2?.remoteFileUrl).toBe("blob://books/user-1/book-2/book.epub");
    expect(book2?.remoteCoverUrl).toBe("blob://covers/user-1/book-2/cover.jpg");
    expect(recordChangeMock).toHaveBeenCalledTimes(3);
  });
});

describe("reloadBookFiles", () => {
  it("falls back to reupload when remote file and cover downloads return 404", async () => {
    await set(
      "book-stale",
      {
        id: "book-stale",
        title: "stale",
        coverImage: new Blob(["cover:stale"], { type: "image/jpeg" }),
        remoteFileUrl: "blob://missing-file",
        remoteCoverUrl: "blob://missing-cover",
        hasLocalFile: true,
        updatedAt: 1,
      },
      bookStore,
    );
    await set("book-stale", new TextEncoder().encode("file:stale").buffer, bookDataStore);
    const fetchMock = vi.fn(async () => new Response("missing", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    uploadMock.mockImplementation(async (pathname) => ({ url: `blob://${pathname}` }));

    await reloadBookFiles({ userId: "user-1", uploadRetryState: new Map() }, "book-stale");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(uploadMock.mock.calls.map(([pathname]) => pathname)).toEqual([
      "books/user-1/book-stale/book.epub",
      "covers/user-1/book-stale/cover.jpg",
    ]);
    const book = await get<Record<string, unknown>>("book-stale", bookStore);
    expect(book?.remoteFileUrl).toBe("blob://books/user-1/book-stale/book.epub");
    expect(book?.remoteCoverUrl).toBe("blob://covers/user-1/book-stale/cover.jpg");
    expect(recordChangeMock).toHaveBeenCalledTimes(2);
  });
});