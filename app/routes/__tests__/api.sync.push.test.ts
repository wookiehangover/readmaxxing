import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChangeEntry } from "~/lib/sync/types";

vi.mock("~/lib/database/book/book", () => ({
  upsertBook: vi.fn(async () => null),
  softDeleteBook: vi.fn(async () => true),
  updateBookBlobUrls: vi.fn(async () => null),
}));

vi.mock("~/lib/database/book/canonical-book-write", () => ({
  withCanonicalBookWrite: vi.fn(),
}));

vi.mock("~/lib/database/auth-middleware", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("~/lib/database/annotation/highlight", () => ({
  upsertHighlight: vi.fn(),
  softDeleteHighlight: vi.fn(),
}));
vi.mock("~/lib/database/annotation/notebook", () => ({ upsertNotebook: vi.fn() }));
vi.mock("~/lib/database/bookmark/bookmark", () => ({
  upsertBookmark: vi.fn(),
  softDeleteBookmark: vi.fn(),
}));
vi.mock("~/lib/database/book/reading-position", () => ({ upsertPosition: vi.fn() }));
vi.mock("~/lib/database/chat/chat-session", () => ({
  upsertSession: vi.fn(),
  softDeleteSession: vi.fn(),
  upsertMessage: vi.fn(),
}));
vi.mock("~/lib/database/settings/user-settings", () => ({ upsertSettings: vi.fn() }));
vi.mock("~/lib/database/user/user", () => ({ upsertUser: vi.fn() }));

import { withCanonicalBookWrite } from "~/lib/database/book/canonical-book-write";
import { processEntry } from "~/routes/api.sync.push";
import { upsertBook, updateBookBlobUrls } from "~/lib/database/book/book";
import { upsertMessage } from "~/lib/database/chat/chat-session";
import { upsertBookmark, softDeleteBookmark } from "~/lib/database/bookmark/bookmark";
import { upsertPosition } from "~/lib/database/book/reading-position";

const upsertBookMock = upsertBook as ReturnType<typeof vi.fn>;
const updateUrlsMock = updateBookBlobUrls as ReturnType<typeof vi.fn>;
const upsertBookmarkMock = upsertBookmark as ReturnType<typeof vi.fn>;
const softDeleteBookmarkMock = softDeleteBookmark as ReturnType<typeof vi.fn>;
const upsertPositionMock = upsertPosition as ReturnType<typeof vi.fn>;

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
  vi.mocked(withCanonicalBookWrite)
    .mockReset()
    .mockImplementation((_userId, entry, write) => write(entry));
  upsertBookMock.mockClear();
  updateUrlsMock.mockClear();
  upsertBookmarkMock.mockClear();
  softDeleteBookmarkMock.mockClear();
  upsertPositionMock.mockClear();
});

describe("processEntry book transaction contract", () => {
  it("returns the canonical transaction result with the original entry", async () => {
    const entry = makeBookEntry();
    vi.mocked(withCanonicalBookWrite).mockResolvedValueOnce({
      accepted: true,
      canonicalId: "book-canonical",
    });
    expect(await processEntry("u1", entry)).toEqual({
      accepted: true,
      canonicalId: "book-canonical",
    });
    expect(withCanonicalBookWrite).toHaveBeenCalledWith("u1", entry, expect.any(Function));
    expect(upsertBookMock).not.toHaveBeenCalled();
  });

  it("passes null deletedAt for restored book put entries", async () => {
    await processEntry("u1", makeBookEntry({ data: { id: "book-new", deletedAt: null } }));

    expect(upsertBookMock).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ deletedAt: null }),
      undefined,
    );
  });

  it("passes deletedAt for soft-deleted book put entries", async () => {
    await processEntry("u1", makeBookEntry({ data: { id: "book-new", deletedAt: 0 } }));

    expect(upsertBookMock).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ deletedAt: new Date(0) }),
      undefined,
    );
  });

  it("passes null deletedAt for live book put entries with no deletedAt field", async () => {
    await processEntry("u1", makeBookEntry({ data: { id: "book-new", updatedAt: 2000 } }));

    expect(upsertBookMock).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ deletedAt: null }),
      undefined,
    );
  });
});

describe("processEntry position branch", () => {
  it("passes position content and the change timestamp to the furthest-wins upsert", async () => {
    const result = await processEntry("u1", {
      id: "change-position-1",
      entity: "position",
      entityId: "book-1",
      operation: "put",
      data: { bookId: "book-1", cfi: "page:12" },
      timestamp: 2000,
      synced: false,
    });

    expect(result).toEqual({ accepted: true });
    expect(upsertPositionMock).toHaveBeenCalledWith(
      "u1",
      "book-1",
      "page:12",
      new Date(2000),
      undefined,
    );
  });
});

describe("processEntry book blob URLs", () => {
  it("includes blob URLs in the same version-guarded book upsert", async () => {
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
    expect(upsertBookMock).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        id: "book-new",
        fileBlobUrl: "https://blob.vercel-storage.com/file.epub",
        coverBlobUrl: "https://blob.vercel-storage.com/cover.jpg",
      }),
      undefined,
    );
  });

  it("does not call updateBookBlobUrls when neither URL is provided", async () => {
    const entry = makeBookEntry({
      data: { id: "book-new", title: "Test", updatedAt: 2000 },
    });

    await processEntry("u1", entry);

    expect(upsertBookMock).toHaveBeenCalled();
    expect(updateUrlsMock).not.toHaveBeenCalled();
  });

  it("passes undefined for the missing URL so COALESCE preserves existing DB values", async () => {
    const entry = makeBookEntry({
      data: {
        id: "book-new",
        remoteFileUrl: "https://blob.vercel-storage.com/file.epub",
        updatedAt: 2000,
      },
    });

    await processEntry("u1", entry);

    expect(upsertBookMock).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        id: "book-new",
        fileBlobUrl: "https://blob.vercel-storage.com/file.epub",
        coverBlobUrl: undefined,
      }),
      undefined,
    );
  });

  it("does not persist URLs after the canonical transaction handled a duplicate", async () => {
    vi.mocked(withCanonicalBookWrite).mockResolvedValueOnce({
      accepted: true,
      canonicalId: "book-canonical",
    });
    const result = await processEntry("u1", makeBookEntry());
    expect(result.canonicalId).toBe("book-canonical");
    expect(upsertBookMock).not.toHaveBeenCalled();
    expect(updateUrlsMock).not.toHaveBeenCalled();
  });
});

describe("processEntry bookmark branch", () => {
  it("upserts bookmark put entries", async () => {
    const result = await processEntry("u1", {
      id: "change-bookmark-1",
      entity: "bookmark",
      entityId: "bookmark-1",
      operation: "put",
      data: {
        id: "bookmark-1",
        bookId: "book-1",
        cfi: "epubcfi(/6/2)",
        label: "Chapter 1",
        pageNumber: null,
        displayPage: 12,
        createdAt: 1000,
        updatedAt: 2000,
      },
      timestamp: 2000,
      synced: false,
    });

    expect(result).toEqual({ accepted: true });
    expect(upsertBookmarkMock).toHaveBeenCalledWith(
      "u1",
      {
        id: "bookmark-1",
        bookId: "book-1",
        cfi: "epubcfi(/6/2)",
        label: "Chapter 1",
        pageNumber: null,
        displayPage: 12,
        createdAt: new Date(1000),
        updatedAt: new Date(2000),
        deletedAt: null,
      },
      undefined,
    );
  });

  it("soft-deletes bookmark delete entries", async () => {
    const result = await processEntry("u1", {
      id: "change-bookmark-2",
      entity: "bookmark",
      entityId: "bookmark-1",
      operation: "delete",
      data: null,
      timestamp: 2000,
      synced: false,
    });

    expect(result).toEqual({ accepted: true });
    expect(softDeleteBookmarkMock).toHaveBeenCalledWith(
      "u1",
      "bookmark-1",
      new Date(2000),
      undefined,
    );
  });
});

describe("processEntry chat_message branch", () => {
  const upsertMessageMock = upsertMessage as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    upsertMessageMock.mockClear();
  });

  it("rejects put entries without hitting the DB", async () => {
    const entry: ChangeEntry = {
      id: "change-msg-1",
      entity: "chat_message",
      entityId: "msg-1",
      operation: "put",
      data: {
        id: "msg-1",
        sessionId: "sess-1",
        role: "user",
        content: "hi",
        createdAt: 9999999999999,
      },
      timestamp: 2000,
      synced: false,
    };

    const result = await processEntry("u1", entry);

    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/not accepted/i);
    expect(upsertMessageMock).not.toHaveBeenCalled();
  });

  it("rejects delete entries without hitting the DB", async () => {
    const entry: ChangeEntry = {
      id: "change-msg-2",
      entity: "chat_message",
      entityId: "msg-2",
      operation: "delete",
      data: null,
      timestamp: 2000,
      synced: false,
    };

    const result = await processEntry("u1", entry);

    expect(result.accepted).toBe(false);
    expect(upsertMessageMock).not.toHaveBeenCalled();
  });
});

it("keeps permanent validation rejections permanent when the parent book also failed", async () => {
  const failedBooks = new Set(["book-new"]);
  const notebook = {
    ...makeBookEntry(),
    entity: "notebook" as const,
    data: { bookId: "book-new" },
  };
  expect(await processEntry("u1", { ...notebook, timestamp: Infinity }, failedBooks)).toMatchObject(
    { accepted: false, retryable: false },
  );
  expect(
    await processEntry("u1", { ...notebook, entity: "chat_message" }, failedBooks),
  ).toMatchObject({ accepted: false, retryable: false });
  expect(await processEntry("u1", notebook, failedBooks)).toMatchObject({
    accepted: false,
    retryable: true,
  });
});
