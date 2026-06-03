import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStore, clear, get, set } from "idb-keyval";
import { Blob as NodeBlob } from "node:buffer";

vi.mock("../remap", () => ({
  remapBookId: vi.fn(async () => {}),
}));

import { remapBookId } from "../remap";
import { mergeBookRecord } from "../sync-engine";

const remapSpy = remapBookId as unknown as ReturnType<typeof vi.fn>;

// Must match the IDB db/store names used in sync-engine.ts.
const bookStore = createStore("ebook-reader-db", "books");
// Must match getBookDataStore() in stores.ts.
const bookDataStore = createStore("ebook-reader-book-data", "book-data");

beforeEach(async () => {
  remapSpy.mockClear();
  await clear(bookStore);
  await clear(bookDataStore);
});

describe("mergeBookRecord pull-path dedup", () => {
  it("invokes remapBookId(localId, incomingId) when a local book shares fileHash under a different id", async () => {
    await set(
      "local-1",
      {
        id: "local-1",
        title: "Local copy",
        author: "A",
        coverImage: null,
        format: "epub",
        fileHash: "abc-hash",
        updatedAt: 100,
      },
      bookStore,
    );

    await mergeBookRecord({
      id: "remote-2",
      title: "Remote copy",
      author: "A",
      format: "epub",
      fileHash: "abc-hash",
      updatedAt: 200,
    });

    expect(remapSpy).toHaveBeenCalledTimes(1);
    expect(remapSpy).toHaveBeenCalledWith("local-1", "remote-2");

    // Local record still present (real remap, which would tombstone it, is mocked).
    const localAfter = await get<Record<string, unknown>>("local-1", bookStore);
    expect(localAfter).toBeDefined();
    expect(localAfter?.fileHash).toBe("abc-hash");

    // The canonical (incoming) record is now stored under the remote id.
    const canonical = await get<Record<string, unknown>>("remote-2", bookStore);
    expect(canonical).toBeDefined();
    expect(canonical?.fileHash).toBe("abc-hash");
    expect(canonical?.id).toBe("remote-2");
  });

  it("does not invoke remapBookId when no local book matches the incoming fileHash", async () => {
    await set(
      "local-1",
      {
        id: "local-1",
        title: "Different book",
        author: "A",
        coverImage: null,
        format: "epub",
        fileHash: "different-hash",
        updatedAt: 100,
      },
      bookStore,
    );

    await mergeBookRecord({
      id: "remote-2",
      title: "Remote",
      author: "A",
      format: "epub",
      fileHash: "abc-hash",
      updatedAt: 200,
    });

    expect(remapSpy).not.toHaveBeenCalled();
  });

  it("does not invoke remapBookId when incoming record shares the same id as the local one", async () => {
    await set(
      "same-id",
      {
        id: "same-id",
        title: "Local",
        author: "A",
        coverImage: null,
        format: "epub",
        fileHash: "abc-hash",
        updatedAt: 100,
      },
      bookStore,
    );

    await mergeBookRecord({
      id: "same-id",
      title: "Remote",
      author: "A",
      format: "epub",
      fileHash: "abc-hash",
      updatedAt: 200,
    });

    expect(remapSpy).not.toHaveBeenCalled();
  });

  it("does not invoke remapBookId for tombstoned incoming records even when hash matches", async () => {
    await set(
      "local-1",
      {
        id: "local-1",
        title: "Local",
        author: "A",
        coverImage: null,
        format: "epub",
        fileHash: "abc-hash",
        updatedAt: 100,
      },
      bookStore,
    );

    await mergeBookRecord({
      id: "remote-2",
      title: "Remote",
      author: "A",
      format: "epub",
      fileHash: "abc-hash",
      updatedAt: 200,
      deletedAt: 250,
    });

    expect(remapSpy).not.toHaveBeenCalled();
  });
});

describe("mergeBookRecord preserves local blob URLs on server-wins merge", () => {
  it("keeps local remoteCoverUrl and remoteFileUrl when the server record has nullish blob URLs", async () => {
    await set(
      "book-1",
      {
        id: "book-1",
        title: "Local",
        author: "A",
        coverImage: null,
        format: "epub",
        fileHash: "abc",
        remoteCoverUrl: "https://blob.vercel/cover-1",
        remoteFileUrl: "https://blob.vercel/file-1",
        hasLocalFile: true,
        updatedAt: 100,
      },
      bookStore,
    );

    // Server record wins LWW (newer updatedAt) but has no blob URLs.
    // Simulates another device that created the row but hasn't uploaded
    // yet, or this device's upload push not yet landing on the server.
    await mergeBookRecord({
      id: "book-1",
      title: "Remote",
      author: "A",
      format: "epub",
      fileHash: "abc",
      coverBlobUrl: null,
      fileBlobUrl: null,
      updatedAt: 200,
    });

    const after = await get<Record<string, unknown>>("book-1", bookStore);
    expect(after).toBeDefined();
    expect(after?.title).toBe("Remote");
    expect(after?.remoteCoverUrl).toBe("https://blob.vercel/cover-1");
    expect(after?.remoteFileUrl).toBe("https://blob.vercel/file-1");
    expect(after?.hasLocalFile).toBe(true);
  });

  it("uses server remoteCoverUrl and remoteFileUrl when the server record provides them", async () => {
    await set(
      "book-2",
      {
        id: "book-2",
        title: "Local",
        author: "A",
        coverImage: null,
        format: "epub",
        fileHash: "abc",
        remoteCoverUrl: "https://blob.vercel/cover-old",
        remoteFileUrl: "https://blob.vercel/file-old",
        hasLocalFile: true,
        updatedAt: 100,
      },
      bookStore,
    );

    await mergeBookRecord({
      id: "book-2",
      title: "Remote",
      author: "A",
      format: "epub",
      fileHash: "abc",
      coverBlobUrl: "https://blob.vercel/cover-new",
      fileBlobUrl: "https://blob.vercel/file-new",
      updatedAt: 200,
    });

    const after = await get<Record<string, unknown>>("book-2", bookStore);
    expect(after?.remoteCoverUrl).toBe("https://blob.vercel/cover-new");
    expect(after?.remoteFileUrl).toBe("https://blob.vercel/file-new");
  });

  it("leaves local URLs untouched when the local record wins LWW", async () => {
    await set(
      "book-3",
      {
        id: "book-3",
        title: "Local newer",
        author: "A",
        coverImage: null,
        format: "epub",
        fileHash: "abc",
        remoteCoverUrl: "https://blob.vercel/cover-local",
        remoteFileUrl: "https://blob.vercel/file-local",
        hasLocalFile: true,
        updatedAt: 300,
      },
      bookStore,
    );

    await mergeBookRecord({
      id: "book-3",
      title: "Remote older",
      author: "A",
      format: "epub",
      fileHash: "abc",
      coverBlobUrl: null,
      fileBlobUrl: null,
      updatedAt: 200,
    });

    const after = await get<Record<string, unknown>>("book-3", bookStore);
    expect(after?.title).toBe("Local newer");
    expect(after?.remoteCoverUrl).toBe("https://blob.vercel/cover-local");
    expect(after?.remoteFileUrl).toBe("https://blob.vercel/file-local");
  });

  it("clears stale local URLs when the server URL is nullish and local source bytes exist", async () => {
    const originalBlob = globalThis.Blob;
    try {
      globalThis.Blob = NodeBlob as typeof Blob;

      await set("book-4", new ArrayBuffer(8), bookDataStore);
      await set(
        "book-4",
        {
          id: "book-4",
          title: "Local",
          author: "A",
          coverImage: new NodeBlob(["cover-bytes"], { type: "image/jpeg" }),
          format: "epub",
          fileHash: "abc",
          remoteCoverUrl: "https://blob.vercel/cover-stale",
          remoteFileUrl: "https://blob.vercel/file-stale",
          hasLocalFile: true,
          updatedAt: 100,
        },
        bookStore,
      );

      const before = await get<Record<string, unknown>>("book-4", bookStore);
      expect(before?.coverImage).toBeInstanceOf(Blob);

      // Server record wins LWW with no blob URLs — its row genuinely lost
      // them. We hold local bytes, so the stale local URLs must be cleared
      // so uploadPendingFiles re-uploads.
      await mergeBookRecord({
        id: "book-4",
        title: "Remote",
        author: "A",
        format: "epub",
        fileHash: "abc",
        coverBlobUrl: null,
        fileBlobUrl: null,
        updatedAt: 200,
      });

      const after = await get<Record<string, unknown>>("book-4", bookStore);
      expect(after?.title).toBe("Remote");
      expect(after?.remoteCoverUrl).toBeUndefined();
      expect(after?.remoteFileUrl).toBeUndefined();
    } finally {
      globalThis.Blob = originalBlob;
    }
  });

  it("preserves local URLs when the server URL is nullish but there are no local source bytes", async () => {
    // No entry in bookDataStore for book-5 and no Blob coverImage.
    await set(
      "book-5",
      {
        id: "book-5",
        title: "Local",
        author: "A",
        coverImage: null,
        format: "epub",
        fileHash: "abc",
        remoteCoverUrl: "https://blob.vercel/cover-1",
        remoteFileUrl: "https://blob.vercel/file-1",
        hasLocalFile: true,
        updatedAt: 100,
      },
      bookStore,
    );

    await mergeBookRecord({
      id: "book-5",
      title: "Remote",
      author: "A",
      format: "epub",
      fileHash: "abc",
      coverBlobUrl: null,
      fileBlobUrl: null,
      updatedAt: 200,
    });

    const after = await get<Record<string, unknown>>("book-5", bookStore);
    expect(after?.title).toBe("Remote");
    expect(after?.remoteCoverUrl).toBe("https://blob.vercel/cover-1");
    expect(after?.remoteFileUrl).toBe("https://blob.vercel/file-1");
  });
});
