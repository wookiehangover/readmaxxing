// @vitest-environment node

import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBookByIdForUser, type BookRow } from "~/lib/database/book/book";
import { getShareLink, type ShareLinkRow } from "~/lib/database/share/share-link";
import { signDownloadToken } from "~/lib/share-download-token";
import { writeLocalFile } from "~/lib/storage/local-file-storage.server";
import { loader } from "~/routes/api.share.$id";

vi.mock("~/lib/database/book/book", () => ({ getBookByIdForUser: vi.fn() }));
vi.mock("~/lib/database/share/share-link", () => ({
  getShareLink: vi.fn(),
  incrementUseCount: vi.fn(),
}));

let share: ShareLinkRow;

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgres://test");
  vi.stubEnv("BLOB_STORAGE_BACKEND", "local");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("SHARE_DOWNLOAD_SECRET", "local-share-test-secret");
  share = {
    id: "test-share",
    userId: `share-file-test-${randomUUID()}`,
    bookId: "test-book",
    maxUses: 1,
    useCount: 1,
    shareChats: false,
    createdAt: new Date(),
    expiresAt: null,
  };
  const book: BookRow = {
    id: share.bookId,
    userId: share.userId,
    title: "Shared book",
    author: "Author",
    format: "epub",
    coverBlobUrl: null,
    fileBlobUrl: `/api/sync/files/download?bookId=${share.bookId}&type=file`,
    fileHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
  vi.mocked(getShareLink).mockResolvedValue(share);
  vi.mocked(getBookByIdForUser).mockResolvedValue(book);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  await rm(join(process.cwd(), "data", "blob", share.userId), { recursive: true, force: true });
});

function download(token = signDownloadToken(share.id, share.useCount)) {
  return loader({
    request: new Request(`http://localhost/api/share/${share.id}?download=${token}`),
    params: { id: share.id },
  });
}

describe("shared local book downloads", () => {
  it("serves the owner's local file with a valid token after the final allowed import", async () => {
    const data = Uint8Array.of(80, 75, 3, 4);
    await writeLocalFile({
      userId: share.userId,
      bookId: share.bookId,
      type: "file",
      data,
      contentType: "application/epub+zip",
    });

    const response = await download();

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(data);
    expect(response.headers.get("Content-Type")).toBe("application/epub+zip");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(getBookByIdForUser).toHaveBeenCalledWith(share.bookId, share.userId);
  });

  it("returns 404 when the locally stored file is missing", async () => {
    expect((await download()).status).toBe(404);
  });

  it("rejects an invalid token before looking up the book", async () => {
    expect((await download("invalid")).status).toBe(403);
    expect(getBookByIdForUser).not.toHaveBeenCalled();
  });
});
