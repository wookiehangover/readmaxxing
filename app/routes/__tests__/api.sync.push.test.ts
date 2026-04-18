import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChangeEntry } from "~/lib/sync/types";

vi.mock("~/lib/database/book/book", () => ({
  upsertBook: vi.fn(async () => null),
  softDeleteBook: vi.fn(async () => true),
  findBookByUserAndHash: vi.fn(async () => null),
  insertTombstonedBook: vi.fn(async () => null),
  getBookByIdForUser: vi.fn(async () => null),
  updateBookBlobUrls: vi.fn(async () => null),
}));

vi.mock("~/lib/database/auth-middleware", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("~/lib/database/annotation/highlight", () => ({
  upsertHighlight: vi.fn(),
  softDeleteHighlight: vi.fn(),
}));
vi.mock("~/lib/database/annotation/notebook", () => ({ upsertNotebook: vi.fn() }));
vi.mock("~/lib/database/book/reading-position", () => ({ upsertPosition: vi.fn() }));
vi.mock("~/lib/database/chat/chat-session", () => ({
  upsertSession: vi.fn(),
  softDeleteSession: vi.fn(),
  upsertMessage: vi.fn(),
}));
vi.mock("~/lib/database/settings/user-settings", () => ({ upsertSettings: vi.fn() }));
vi.mock("~/lib/database/user/user", () => ({ upsertUser: vi.fn() }));

import { processEntry } from "~/routes/api.sync.push";
import {
  upsertBook,
  findBookByUserAndHash,
  insertTombstonedBook,
  getBookByIdForUser,
  updateBookBlobUrls,
} from "~/lib/database/book/book";

const upsertBookMock = upsertBook as ReturnType<typeof vi.fn>;
const findMock = findBookByUserAndHash as ReturnType<typeof vi.fn>;
const insertTombstoneMock = insertTombstonedBook as ReturnType<typeof vi.fn>;
const getByIdMock = getBookByIdForUser as ReturnType<typeof vi.fn>;
const updateUrlsMock = updateBookBlobUrls as ReturnType<typeof vi.fn>;

function makeBookEntry(overrides: Partial<ChangeEntry> = {}): ChangeEntry {
  return {
    id: "change-1",
    entity: "book",
    entityId: "book-new",
    operation: "put",
    data: {
      id: "book-new",
      title: "Dup",
      author: "Anon",
      format: "epub",
      fileHash: "hash-abc",
      updatedAt: 2000,
    },
    timestamp: 2000,
    synced: false,
    ...overrides,
  };
}

beforeEach(() => {
  upsertBookMock.mockClear();
  findMock.mockReset();
  insertTombstoneMock.mockReset();
  getByIdMock.mockReset();
  updateUrlsMock.mockClear();
});

describe("processEntry book dedup branch", () => {
  it("returns canonicalId and tombstones incoming when fileHash matches a different book", async () => {
    findMock.mockResolvedValue({
      id: "book-canonical",
      userId: "u1",
      fileHash: "hash-abc",
      deletedAt: null,
    });
    getByIdMock.mockResolvedValue(null);

    const result = await processEntry("u1", makeBookEntry());

    expect(result).toEqual({ accepted: true, canonicalId: "book-canonical" });
    expect(insertTombstoneMock).toHaveBeenCalledWith("u1", {
      id: "book-new",
      fileHash: "hash-abc",
      createdAt: new Date(2000),
    });
    expect(upsertBookMock).not.toHaveBeenCalled();
  });

  it("does not tombstone when the incoming id is already soft-deleted", async () => {
    findMock.mockResolvedValue({
      id: "book-canonical",
      userId: "u1",
      fileHash: "hash-abc",
      deletedAt: null,
    });
    getByIdMock.mockResolvedValue({
      id: "book-new",
      userId: "u1",
      deletedAt: new Date(),
    });

    const result = await processEntry("u1", makeBookEntry());

    expect(result.canonicalId).toBe("book-canonical");
    expect(insertTombstoneMock).not.toHaveBeenCalled();
  });

  it("upserts normally when fileHash is missing", async () => {
    const entry = makeBookEntry({
      data: { id: "book-new", title: "No hash", updatedAt: 1000 },
    });

    const result = await processEntry("u1", entry);

    expect(result).toEqual({ accepted: true });
    expect(findMock).not.toHaveBeenCalled();
    expect(upsertBookMock).toHaveBeenCalled();
  });

  it("upserts normally when no existing book matches the fileHash", async () => {
    findMock.mockResolvedValue(null);

    const result = await processEntry("u1", makeBookEntry());

    expect(result).toEqual({ accepted: true });
    expect(upsertBookMock).toHaveBeenCalled();
    expect(insertTombstoneMock).not.toHaveBeenCalled();
  });

  it("upserts normally when the matching canonical is the same id (idempotent re-push)", async () => {
    findMock.mockResolvedValue({
      id: "book-new",
      userId: "u1",
      fileHash: "hash-abc",
      deletedAt: null,
    });

    const result = await processEntry("u1", makeBookEntry());

    expect(result).toEqual({ accepted: true });
    expect(upsertBookMock).toHaveBeenCalled();
    expect(insertTombstoneMock).not.toHaveBeenCalled();
  });
});

describe("processEntry book blob URLs", () => {
  it("calls updateBookBlobUrls with both URLs when the client sends them", async () => {
    findMock.mockResolvedValue(null);
    const entry = makeBookEntry({
      data: {
        id: "book-new",
        title: "Test",
        fileHash: "hash-abc",
        remoteFileUrl: "https://blob.vercel-storage.com/file.epub",
        remoteCoverUrl: "https://blob.vercel-storage.com/cover.jpg",
        updatedAt: 2000,
      },
    });

    const result = await processEntry("u1", entry);

    expect(result).toEqual({ accepted: true });
    expect(upsertBookMock).toHaveBeenCalled();
    expect(updateUrlsMock).toHaveBeenCalledWith("book-new", {
      fileBlobUrl: "https://blob.vercel-storage.com/file.epub",
      coverBlobUrl: "https://blob.vercel-storage.com/cover.jpg",
    });
  });

  it("does not call updateBookBlobUrls when neither URL is provided", async () => {
    findMock.mockResolvedValue(null);
    const entry = makeBookEntry({
      data: { id: "book-new", title: "Test", updatedAt: 2000 },
    });

    await processEntry("u1", entry);

    expect(upsertBookMock).toHaveBeenCalled();
    expect(updateUrlsMock).not.toHaveBeenCalled();
  });

  it("passes undefined for the missing URL so COALESCE preserves existing DB values", async () => {
    findMock.mockResolvedValue(null);
    const entry = makeBookEntry({
      data: {
        id: "book-new",
        remoteFileUrl: "https://blob.vercel-storage.com/file.epub",
        updatedAt: 2000,
      },
    });

    await processEntry("u1", entry);

    expect(updateUrlsMock).toHaveBeenCalledWith("book-new", {
      fileBlobUrl: "https://blob.vercel-storage.com/file.epub",
      coverBlobUrl: undefined,
    });
  });

  it("does not persist URLs on the dedup tombstone branch", async () => {
    findMock.mockResolvedValue({
      id: "book-canonical",
      userId: "u1",
      fileHash: "hash-abc",
      deletedAt: null,
    });
    getByIdMock.mockResolvedValue(null);

    const result = await processEntry(
      "u1",
      makeBookEntry({
        data: {
          id: "book-new",
          fileHash: "hash-abc",
          remoteFileUrl: "https://blob.vercel-storage.com/file.epub",
          updatedAt: 2000,
        },
      }),
    );

    expect(result.canonicalId).toBe("book-canonical");
    expect(updateUrlsMock).not.toHaveBeenCalled();
  });
});
