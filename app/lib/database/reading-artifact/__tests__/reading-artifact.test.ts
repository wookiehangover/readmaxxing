import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
const clientQueryMock = vi.hoisted(() => vi.fn());
const releaseMock = vi.hoisted(() => vi.fn());
const connectMock = vi.hoisted(() =>
  vi.fn(() => ({ query: clientQueryMock, release: releaseMock })),
);

vi.mock("../../pool", () => ({
  getPool: () => ({ query: queryMock, connect: connectMock }),
}));

import {
  acquireReadingAgentLease,
  claimReadingIngestUnit,
  completeReadingIngestUnit,
  getNextDueReadingIngestUnit,
  insertReadingAgentUsage,
  insertReadingArtifactRevision,
  insertReadingIngestUnit,
  upsertCurrentReadingArtifact,
} from "../reading-artifact";

type SqlQuery = { _items: Array<{ type: string; value?: unknown; text?: string }> };

function extractSqlText(query: SqlQuery): string {
  return query._items
    .filter((item) => item.type === "RAW")
    .map((item) => item.text)
    .join("");
}

function extractValues(query: SqlQuery): unknown[] {
  return query._items.filter((item) => item.type === "VALUE").map((item) => item.value);
}

beforeEach(() => {
  queryMock.mockReset();
  clientQueryMock.mockReset();
  releaseMock.mockReset();
  connectMock.mockClear();
});

describe("reading artifact persistence", () => {
  it("claims a pending unit only once", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(claimReadingIngestUnit("unit-1")).resolves.toBeNull();

    const query = queryMock.mock.calls[0][0] as SqlQuery;
    expect(extractSqlText(query)).toContain("status IN ('pending', 'error')");
  });

  it("returns null when a user already has an agent lease", async () => {
    const lease = { userId: "user-1", unitId: "unit-1" };
    queryMock.mockResolvedValueOnce({ rows: [lease] }).mockResolvedValueOnce({ rows: [] });

    await expect(
      acquireReadingAgentLease("unit-1", new Date("2026-01-01T00:04:00Z")),
    ).resolves.toBe(lease);
    await expect(
      acquireReadingAgentLease("unit-2", new Date("2026-01-01T00:04:00Z")),
    ).resolves.toBeNull();

    const query = queryMock.mock.calls[1][0] as SqlQuery;
    expect(extractSqlText(query)).toContain("ON CONFLICT DO NOTHING");
  });

  it("selects the oldest due retryable unit for a user", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(getNextDueReadingIngestUnit("user-1")).resolves.toBeNull();

    const query = queryMock.mock.calls[0][0] as SqlQuery;
    expect(extractSqlText(query)).toContain("next_attempt_at <= NOW()");
    expect(extractSqlText(query)).toContain("attempt_count < 8");
    expect(extractValues(query)).toContain("user-1");
  });

  it("inserts per-unit token usage", async () => {
    const usage = { id: "usage-1", unitId: "unit-1", source: "unknown" };
    queryMock.mockResolvedValueOnce({ rows: [usage] });

    await expect(
      insertReadingAgentUsage({
        unitId: "unit-1",
        input: 10,
        output: 20,
        cacheRead: 3,
        cacheWrite: 4,
        totalTokens: 37,
        costTotal: "0.00120000",
        model: "test-model",
        source: "unknown",
      }),
    ).resolves.toBe(usage);

    const query = queryMock.mock.calls[0][0] as SqlQuery;
    expect(extractSqlText(query)).toContain("INSERT INTO readmax.reading_agent_usage");
    expect(extractValues(query)).toEqual([
      "unit-1",
      10,
      20,
      3,
      4,
      37,
      "0.00120000",
      "test-model",
      "unknown",
    ]);
  });

  it("returns null instead of failing when an ingest fingerprint conflicts", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(
      insertReadingIngestUnit({
        userId: "user-1",
        bookId: "book-1",
        fingerprint: "fingerprint-1",
        unitKind: "epub-spine",
        locator: "text/chapter-1.xhtml",
        text: "Chapter text",
      }),
    ).resolves.toBeNull();

    const query = queryMock.mock.calls[0][0] as SqlQuery;
    expect(extractSqlText(query)).toContain(
      "ON CONFLICT (user_id, book_id, fingerprint) DO NOTHING",
    );
  });

  it("returns an inserted artifact revision", async () => {
    const revision = { id: "revision-1" };
    queryMock.mockResolvedValueOnce({ rows: [revision] });

    await expect(
      insertReadingArtifactRevision({
        userId: "user-1",
        bookId: "book-1",
        kind: "wiki",
        content: "Story so far",
        actor: "agent",
        sourceUnitId: "unit-1",
        sourceFingerprint: "fingerprint-1",
        summary: "Added chapter one",
      }),
    ).resolves.toBe(revision);
  });

  it("upserts the current artifact head", async () => {
    const artifact = { revisionId: "revision-1" };
    queryMock.mockResolvedValueOnce({ rows: [artifact] });

    await expect(
      upsertCurrentReadingArtifact({
        userId: "user-1",
        bookId: "book-1",
        kind: "wiki",
        content: "Story so far",
        revisionId: "revision-1",
      }),
    ).resolves.toBe(artifact);

    const query = queryMock.mock.calls[0][0] as SqlQuery;
    expect(extractSqlText(query)).toContain("ON CONFLICT (user_id, book_id, kind) DO UPDATE");
  });

  it("atomically creates a revision, advances its head, and completes the unit", async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "unit-1" }] })
      .mockResolvedValueOnce({ rows: [{ content: "Old story", revisionId: "revision-1" }] })
      .mockResolvedValueOnce({ rows: [{ id: "revision-2" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const unit = {
      id: "unit-1",
      userId: "user-1",
      bookId: "book-1",
      fingerprint: "fingerprint-1",
      unitKind: "epub-spine" as const,
      locator: "chapter.xhtml",
      chapterLabel: null,
      text: "New page",
      status: "processing" as const,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      attemptCount: 0,
      claimedAt: new Date(),
      nextAttemptAt: new Date(),
      processedAt: null,
      error: null,
    };

    await expect(
      completeReadingIngestUnit(unit, [
        { kind: "wiki", content: "New story", summary: "Added the scene" },
      ]),
    ).resolves.toBe(1);

    const revision = clientQueryMock.mock.calls[3][0] as SqlQuery;
    expect(extractSqlText(revision)).toContain("previous_revision_id, actor");
    expect(extractSqlText(revision)).toContain("'agent'");
    expect(extractValues(revision)).toContain("revision-1");
    expect(extractValues(revision)).toContain("fingerprint-1");
    expect(clientQueryMock).toHaveBeenNthCalledWith(7, "COMMIT");
    expect(releaseMock).toHaveBeenCalledOnce();
  });
});
