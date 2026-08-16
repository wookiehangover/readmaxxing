import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/database/auth-middleware", () => ({
  getSessionFromRequest: vi.fn(),
}));

vi.mock("~/lib/database/book/book", () => ({
  getBookByIdForUser: vi.fn(),
}));

vi.mock("~/lib/database/reading-artifact/reading-artifact", () => ({
  getCurrentReadingArtifacts: vi.fn(),
  getReadingIngestUnitByLocator: vi.fn(),
  insertReadingIngestUnit: vi.fn(),
  listReadingArtifactRevisions: vi.fn(),
  refreshReadingIngestUnit: vi.fn(),
}));

vi.mock("~/lib/reading-agent/dispatch.server", () => ({
  scheduleReadingIngestQueue: vi.fn(),
}));

import { getSessionFromRequest } from "~/lib/database/auth-middleware";
import { getBookByIdForUser } from "~/lib/database/book/book";
import {
  getCurrentReadingArtifacts,
  getReadingIngestUnitByLocator,
  insertReadingIngestUnit,
  listReadingArtifactRevisions,
  refreshReadingIngestUnit,
} from "~/lib/database/reading-artifact/reading-artifact";
import { scheduleReadingIngestQueue } from "~/lib/reading-agent/dispatch.server";
import { loader as artifactsLoader } from "~/routes/api.books.$bookId.artifacts";
import {
  action as ingestAction,
  computeReadingFingerprint,
  parseIngestPayload,
} from "~/routes/api.books.$bookId.artifacts.ingest";
import { loader as revisionsLoader } from "~/routes/api.books.$bookId.artifacts.revisions";

const authMock = getSessionFromRequest as ReturnType<typeof vi.fn>;
const bookMock = getBookByIdForUser as ReturnType<typeof vi.fn>;
const artifactsMock = getCurrentReadingArtifacts as ReturnType<typeof vi.fn>;
const existingUnitMock = getReadingIngestUnitByLocator as ReturnType<typeof vi.fn>;
const insertUnitMock = insertReadingIngestUnit as ReturnType<typeof vi.fn>;
const revisionsMock = listReadingArtifactRevisions as ReturnType<typeof vi.fn>;
const refreshUnitMock = refreshReadingIngestUnit as ReturnType<typeof vi.fn>;
const scheduleMock = scheduleReadingIngestQueue as ReturnType<typeof vi.fn>;
const originalDatabaseUrl = process.env.DATABASE_URL;

const text = "This is enough normalized reading text to ingest.";
const fingerprint = computeReadingFingerprint({
  userId: "user-1",
  bookId: "book-1",
  locator: "text/chapter-1.xhtml",
});

const ingestBody = {
  fingerprint,
  unitKind: "epub-spine",
  locator: "text/chapter-1.xhtml",
  chapterLabel: "Chapter 1",
  text,
};

const unit = {
  id: "unit-1",
  userId: "user-1",
  bookId: "book-1",
  fingerprint,
  unitKind: "epub-spine",
  locator: "text/chapter-1.xhtml",
  chapterLabel: "Chapter 1",
  text,
  status: "pending",
  firstSeenAt: new Date("2026-01-01T00:00:00Z"),
  lastSeenAt: new Date("2026-01-01T00:00:00Z"),
  processedAt: null,
  error: null,
};

function makeIngestRequest(body: unknown = ingestBody): Request {
  return new Request("http://localhost/api/books/book-1/artifacts/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.DATABASE_URL = "postgres://example";
  authMock.mockReset().mockResolvedValue({ userId: "user-1" });
  bookMock.mockReset().mockResolvedValue({ id: "book-1", userId: "user-1" });
  artifactsMock.mockReset().mockResolvedValue([]);
  existingUnitMock.mockReset().mockResolvedValue(null);
  insertUnitMock.mockReset().mockResolvedValue(unit);
  revisionsMock.mockReset().mockResolvedValue([]);
  refreshUnitMock.mockReset().mockResolvedValue(unit);
  scheduleMock.mockReset();
});

afterEach(() => {
  if (originalDatabaseUrl == null) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("reading artifact ingest API", () => {
  it("returns 401 before looking up a book when unauthenticated", async () => {
    authMock.mockResolvedValue(null);

    const response = await ingestAction({
      request: makeIngestRequest(),
      params: { bookId: "book-1" },
    });

    expect(response.status).toBe(401);
    expect(bookMock).not.toHaveBeenCalled();
    expect(insertUnitMock).not.toHaveBeenCalled();
  });

  it("rejects text that is empty or too short", () => {
    expect(parseIngestPayload({ ...ingestBody, text: "  too short  " })).toEqual({
      error: "text must contain at least 20 characters",
    });
  });

  it("uses the locator rather than viewport text as page identity", () => {
    const first = computeReadingFingerprint({
      userId: "user-1",
      bookId: "book-1",
      locator: "chapter.xhtml#page=2",
    });
    const sameLocator = computeReadingFingerprint({
      userId: "user-1",
      bookId: "book-1",
      locator: "chapter.xhtml#page=2",
    });
    const nextLocator = computeReadingFingerprint({
      userId: "user-1",
      bookId: "book-1",
      locator: "chapter.xhtml#page=3",
    });

    expect(first).toBe(sameLocator);
    expect(first).not.toBe(nextLocator);
  });

  it("returns 404 when the book is not owned by the session user", async () => {
    bookMock.mockResolvedValue(null);

    const response = await ingestAction({
      request: makeIngestRequest(),
      params: { bookId: "book-1" },
    });

    expect(response.status).toBe(404);
    expect(insertUnitMock).not.toHaveBeenCalled();
  });

  it("returns 202 for a newly inserted unit", async () => {
    const response = await ingestAction({
      request: makeIngestRequest(),
      params: { bookId: "book-1" },
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      deduplicated: false,
      unit: { id: "unit-1", fingerprint, status: "pending" },
    });
    expect(scheduleMock).toHaveBeenCalledWith("user-1");
  });

  it("inserts a different locator as a distinct unit", async () => {
    const locator = "text/chapter-1.xhtml#page=2";
    const nextFingerprint = computeReadingFingerprint({
      userId: "user-1",
      bookId: "book-1",
      locator,
    });

    const response = await ingestAction({
      request: makeIngestRequest({ ...ingestBody, fingerprint: nextFingerprint, locator }),
      params: { bookId: "book-1" },
    });

    expect(response.status).toBe(202);
    expect(insertUnitMock).toHaveBeenCalledWith(
      expect.objectContaining({ fingerprint: nextFingerprint, locator }),
    );
  });

  it("returns the existing unit without creating another pending row", async () => {
    existingUnitMock.mockResolvedValue(unit);

    const response = await ingestAction({
      request: makeIngestRequest(),
      params: { bookId: "book-1" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      deduplicated: true,
      unit: { id: "unit-1", fingerprint, status: "pending" },
    });
    expect(insertUnitMock).not.toHaveBeenCalled();
    expect(existingUnitMock).toHaveBeenCalledWith("user-1", "book-1", "text/chapter-1.xhtml");
    expect(refreshUnitMock).toHaveBeenCalledWith({
      userId: "user-1",
      bookId: "book-1",
      unitId: "unit-1",
      chapterLabel: "Chapter 1",
      text,
    });
    expect(scheduleMock).toHaveBeenCalledWith("user-1");
  });

  it("does not reschedule an existing completed locator", async () => {
    existingUnitMock.mockResolvedValue({ ...unit, status: "done" });
    const jitteredText = `${text} One extra edge word.`;

    const response = await ingestAction({
      request: makeIngestRequest({ ...ingestBody, text: jitteredText }),
      params: { bookId: "book-1" },
    });

    expect(response.status).toBe(200);
    expect(insertUnitMock).not.toHaveBeenCalled();
    expect(refreshUnitMock).not.toHaveBeenCalled();
    expect(scheduleMock).not.toHaveBeenCalled();
  });
});

describe("reading artifact read APIs", () => {
  it("returns fixed empty artifact heads when no artifacts exist", async () => {
    const response = await artifactsLoader({
      request: new Request("http://localhost/api/books/book-1/artifacts"),
      params: { bookId: "book-1" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      bookId: "book-1",
      artifacts: { outline: null, characters: null, wiki: null },
    });
  });

  it("requires a valid revision kind and passes the ownership scope to the query", async () => {
    const invalid = await revisionsLoader({
      request: new Request("http://localhost/api/books/book-1/artifacts/revisions?kind=spoilers"),
      params: { bookId: "book-1" },
    });
    expect(invalid.status).toBe(400);

    const valid = await revisionsLoader({
      request: new Request("http://localhost/api/books/book-1/artifacts/revisions?kind=wiki"),
      params: { bookId: "book-1" },
    });
    expect(valid.status).toBe(200);
    expect(revisionsMock).toHaveBeenCalledWith({
      userId: "user-1",
      bookId: "book-1",
      kind: "wiki",
    });
  });
});
