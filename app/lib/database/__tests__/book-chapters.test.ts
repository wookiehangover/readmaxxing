import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
const connectMock = vi.hoisted(() => vi.fn());
const requireAuthMock = vi.hoisted(() => vi.fn());
const getBookByIdForUserMock = vi.hoisted(() => vi.fn());

vi.mock("../pool", () => ({
  getPool: () => ({ query: queryMock, connect: connectMock }),
}));

vi.mock("~/lib/database/auth-middleware", () => ({
  requireAuth: requireAuthMock,
}));

vi.mock("~/lib/database/book/book", () => ({
  getBookByIdForUser: getBookByIdForUserMock,
}));

import {
  ChapterUploadSessionMismatchError,
  mergeBookChapters,
  mergeChaptersByIndex,
  replaceBookChaptersWithLock,
  upsertBookChapters,
} from "../book/book-chapters";
import { action, parseUploadBody } from "../../../routes/api.books.$bookId.chapters";

type SqlQuery = { _items: Array<{ type: string; value?: unknown }> };

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const EXTRACTED_AT = new Date("2026-05-01T12:00:00.000Z");

function extractValues(query: SqlQuery): unknown[] {
  return query._items.filter((i) => i.type === "VALUE").map((i) => i.value);
}

function bookChaptersRow(chapters: unknown, currentUploadId: string | null) {
  return {
    userId: "user-1",
    bookId: "book-1",
    chapters,
    extractedAt: EXTRACTED_AT,
    currentUploadId,
  };
}

function createClient() {
  const client = { query: vi.fn(), release: vi.fn() };
  connectMock.mockResolvedValue(client);
  return client;
}

beforeEach(() => {
  queryMock.mockReset();
  connectMock.mockReset();
  requireAuthMock.mockResolvedValue({ userId: "user-1" });
  getBookByIdForUserMock.mockResolvedValue({ id: "book-1" });
  process.env.DATABASE_URL = "postgres://test";
});

afterEach(() => {
  if (ORIGINAL_DATABASE_URL === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  }
});

describe("mergeChaptersByIndex", () => {
  it("merges incoming chapters by canonical index", () => {
    const existing = [
      { index: 0, title: "Intro", text: "old" },
      { index: 2, title: "Chapter 2", text: "two" },
    ];
    const incoming = [
      { index: 1, title: "Chapter 1", text: "one" },
      { index: 2, title: "Chapter 2", text: "updated" },
    ];

    expect(mergeChaptersByIndex(existing, incoming)).toEqual([
      { index: 0, title: "Intro", text: "old" },
      { index: 1, title: "Chapter 1", text: "one" },
      { index: 2, title: "Chapter 2", text: "updated" },
    ]);
  });

  it("ignores existing values without valid chapter indexes", () => {
    const existing = [{ title: "Missing" }, null, { index: -1, title: "Bad" }];
    const incoming = [{ index: 0, title: "Valid" }];

    expect(mergeChaptersByIndex(existing, incoming)).toEqual([{ index: 0, title: "Valid" }]);
  });
});

describe("parseUploadBody", () => {
  it("accepts the legacy chapter upload shape", () => {
    const chapters = [{ index: 0, title: "Intro", text: "Hello", spineStart: 0, spineEnd: 0 }];

    expect(parseUploadBody({ chapters, format: "epub" })).toEqual({
      kind: "legacy",
      body: { chapters, format: "epub" },
    });
  });

  it("rejects partial upload envelopes", () => {
    expect(parseUploadBody({ uploadId: "upload-1", chapters: [] })).toEqual({
      error:
        "upload envelope must include uploadId, chunkIndex, totalChunks, and totalChapters together",
    });
  });
});

describe("book chapter upload persistence", () => {
  it("chunk-0 replacement stores the current upload id", async () => {
    const chapters = [{ index: 0, title: "Intro" }];
    const client = createClient();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [bookChaptersRow(chapters, "upload-2")] })
      .mockResolvedValueOnce({ rows: [] });

    const row = await replaceBookChaptersWithLock(
      "user-1",
      "book-1",
      "upload-2",
      chapters,
      EXTRACTED_AT,
    );

    expect(row?.currentUploadId).toBe("upload-2");
    expect(extractValues(client.query.mock.calls[2][0] as SqlQuery)[4]).toBe("upload-2");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("matching merge chunks succeed and keep the current upload id", async () => {
    const existing = [{ index: 0, title: "Intro" }];
    const incoming = [{ index: 1, title: "One" }];
    const merged = [...existing, ...incoming];
    const client = createClient();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [bookChaptersRow(existing, "upload-2")] })
      .mockResolvedValueOnce({ rows: [bookChaptersRow(merged, "upload-2")] })
      .mockResolvedValueOnce({ rows: [] });

    const row = await mergeBookChapters("user-1", "book-1", "upload-2", incoming, EXTRACTED_AT);

    expect(row?.chapters).toEqual(merged);
    expect(row?.currentUploadId).toBe("upload-2");
    expect(extractValues(client.query.mock.calls[3][0] as SqlQuery)[4]).toBe("upload-2");
    expect(client.query.mock.calls[4][0]).toBe("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("mismatched merge chunks return 409 and do not write chapters", async () => {
    const existing = [{ index: 0, title: "Intro" }];
    const client = createClient();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [bookChaptersRow(existing, "winning-upload")] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await action({
      request: new Request("http://localhost/api/books/book-1/chapters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId: "stale-upload",
          chunkIndex: 1,
          totalChunks: 2,
          totalChapters: 2,
          chapters: [{ index: 1, title: "One" }],
        }),
      }),
      params: { bookId: "book-1" },
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Upload session superseded; restart from chunk 0",
    });
    expect(client.query).toHaveBeenCalledTimes(4);
    expect(client.query.mock.calls[3][0]).toBe("ROLLBACK");
    expect(client.query.mock.calls[0][0]).toBe("BEGIN");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("mismatched merge chunks throw the tagged mismatch error", async () => {
    const client = createClient();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [bookChaptersRow([], "winning-upload")] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      mergeBookChapters("user-1", "book-1", "stale-upload", [{ index: 1 }], EXTRACTED_AT),
    ).rejects.toBeInstanceOf(ChapterUploadSessionMismatchError);
    expect(client.query).toHaveBeenCalledTimes(4);
  });

  it("legacy single-shot uploads write a null current upload id", async () => {
    const chapters = [{ index: 0, title: "Intro" }];
    queryMock.mockResolvedValue({ rows: [bookChaptersRow(chapters, null)] });

    const row = await upsertBookChapters("user-1", "book-1", chapters, EXTRACTED_AT);

    expect(row?.currentUploadId).toBeNull();
    expect(extractValues(queryMock.mock.calls[0][0] as SqlQuery)[4]).toBeNull();
  });
});
