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
  claimReadingIngestUnitWithLease,
  clearReadingArtifactsAndIngestForUser,
  completeReadingIngestUnit,
  getCurrentReadingAgentLease,
  getLiveReadingAgentLease,
  getLatestReadingAgentUsage,
  getNextDueReadingIngestUnit,
  getReadingAgentSchemaHealth,
  getReadingIngestUnitByLocator,
  insertReadingAgentUsage,
  insertReadingArtifactRevision,
  insertReadingIngestUnit,
  listReadingIngestSweepUserIds,
  listRecentReadingIngestUnits,
  getReadingIngestUnitForUser,
  readingAgentRetryDelaySeconds,
  reclaimExpiredReadingAgentLease,
  refreshReadingIngestUnit,
  resetReadingIngestUnit,
  retryReadingIngestUnit,
  releaseReadingIngestUnit,
  stopReadingIngestUnit,
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

const unknownUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  costTotal: 0,
  model: null,
  source: "unknown",
};

beforeEach(() => {
  queryMock.mockReset();
  clientQueryMock.mockReset();
  releaseMock.mockReset();
  connectMock.mockClear();
});

describe("reading artifact persistence", () => {
  it("reports missing reading-agent queue schema columns", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { tableName: "reading_ingest_unit", columnName: "attempt_count" },
        { tableName: "reading_ingest_unit", columnName: "claimed_at" },
      ],
    });

    await expect(getReadingAgentSchemaHealth()).resolves.toMatchObject({
      ok: false,
      missingColumns: expect.arrayContaining([
        "reading_ingest_unit.next_attempt_at",
        "reading_agent_lease.user_id",
        "reading_agent_usage.id",
      ]),
    });
    expect(extractSqlText(queryMock.mock.calls[0][0] as SqlQuery)).toContain(
      "information_schema.columns",
    );
  });

  it("reads user-scoped status data without selecting ingest text", async () => {
    const lease = { userId: "user-1", unitId: "unit-1", bookId: "book-1" };
    const unit = { unitId: "unit-1", bookId: "book-1", status: "pending" };
    const usage = { id: "usage-1", unitId: "unit-1", totalTokens: 42 };
    queryMock
      .mockResolvedValueOnce({ rows: [lease] })
      .mockResolvedValueOnce({ rows: [unit] })
      .mockResolvedValueOnce({ rows: [usage] });

    await expect(getCurrentReadingAgentLease("user-1")).resolves.toBe(lease);
    await expect(
      listRecentReadingIngestUnits({ userId: "user-1", bookId: "book-1" }),
    ).resolves.toEqual([unit]);
    await expect(getLatestReadingAgentUsage("user-1")).resolves.toBe(usage);

    const leaseQuery = queryMock.mock.calls[0][0] as SqlQuery;
    const unitsQuery = queryMock.mock.calls[1][0] as SqlQuery;
    const usageQuery = queryMock.mock.calls[2][0] as SqlQuery;
    expect(extractValues(leaseQuery)).toEqual(["user-1"]);
    expect(extractValues(unitsQuery)).toEqual(["user-1", "book-1", "book-1"]);
    expect(extractSqlText(unitsQuery)).toContain("ORDER BY last_seen_at DESC");
    expect(extractSqlText(unitsQuery)).toContain("LIMIT 50");
    expect(extractSqlText(unitsQuery)).not.toContain("text AS");
    expect(extractSqlText(unitsQuery)).not.toContain("text,");
    expect(extractValues(usageQuery)).toEqual(["user-1"]);
  });

  it("reads a live lease only when it has not expired", async () => {
    const lease = { unitId: "unit-1", bookId: "book-1" };
    queryMock
      .mockResolvedValueOnce({ rows: [lease] })
      .mockResolvedValueOnce({ rows: [lease] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(getLiveReadingAgentLease("user-1")).resolves.toBe(lease);
    await expect(getCurrentReadingAgentLease("user-1")).resolves.toBe(lease);
    await expect(getLiveReadingAgentLease("user-1")).resolves.toBeNull();

    const liveQuery = queryMock.mock.calls[0][0] as SqlQuery;
    const currentQuery = queryMock.mock.calls[1][0] as SqlQuery;
    expect(extractSqlText(liveQuery)).toContain("expires_at > NOW()");
    expect(extractValues(liveQuery)).toEqual(["user-1"]);
    expect(extractSqlText(currentQuery)).not.toContain("expires_at > NOW()");
    expect(extractValues(currentQuery)).toEqual(["user-1"]);
  });

  it("claims only one of two pending units for the same user", async () => {
    const leaseExpiresAt = new Date("2026-01-01T00:05:00Z");
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ userId: "user-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "unit-1", userId: "user-1", bookId: "book-1", leaseExpiresAt }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ userId: "user-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(claimReadingIngestUnitWithLease("unit-1")).resolves.toEqual({
      unit: { id: "unit-1", userId: "user-1", bookId: "book-1" },
      lease: {
        userId: "user-1",
        unitId: "unit-1",
        bookId: "book-1",
        expiresAt: leaseExpiresAt,
      },
    });
    await expect(claimReadingIngestUnitWithLease("unit-2")).resolves.toBeNull();

    const firstClaim = clientQueryMock.mock.calls[4][0] as SqlQuery;
    const secondClaim = clientQueryMock.mock.calls[10][0] as SqlQuery;
    expect(extractSqlText(firstClaim)).toContain("INSERT INTO readmax.reading_agent_lease");
    expect(extractValues(firstClaim)).toContain(15 * 60 * 1000);
    expect(extractSqlText(firstClaim)).toContain("ON CONFLICT DO NOTHING");
    expect(extractSqlText(secondClaim)).toContain("INSERT INTO readmax.reading_agent_lease");
  });

  it("returns null when a user already has an agent lease", async () => {
    const lease = { userId: "user-1", unitId: "unit-1" };
    queryMock.mockResolvedValueOnce({ rows: [lease] }).mockResolvedValueOnce({ rows: [] });

    await expect(
      acquireReadingAgentLease("unit-1", new Date("2026-01-01T00:15:00Z")),
    ).resolves.toBe(lease);
    await expect(
      acquireReadingAgentLease("unit-2", new Date("2026-01-01T00:15:00Z")),
    ).resolves.toBeNull();

    const query = queryMock.mock.calls[1][0] as SqlQuery;
    expect(extractSqlText(query)).toContain("ON CONFLICT DO NOTHING");
  });

  it("selects due viewport pages before older spine units", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(getNextDueReadingIngestUnit("user-1")).resolves.toBeNull();

    const query = queryMock.mock.calls[0][0] as SqlQuery;
    const text = extractSqlText(query);
    expect(text).toContain("next_attempt_at <= NOW()");
    expect(text).toContain("attempt_count < 8");
    expect(text).toContain("NOT EXISTS");
    expect(text).toContain("locator LIKE '%#page=%'");
    expect(text).toContain("locator LIKE 'page:%'");
    expect(text.indexOf("WHEN locator LIKE")).toBeLessThan(text.indexOf("next_attempt_at ASC"));
    expect(extractValues(query)).toContain("user-1");
  });

  it("sweeps only due or stale users without a live lease", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ userId: "user-1" }] });

    await expect(listReadingIngestSweepUserIds()).resolves.toEqual(["user-1"]);

    const query = queryMock.mock.calls[0][0] as SqlQuery;
    const text = extractSqlText(query);
    expect(text).toContain("next_attempt_at <= NOW()");
    expect(text).toContain("claimed_at <= NOW()");
    expect(text).toContain("expires_at <= NOW()");
    expect(text).toContain("live_lease.expires_at > NOW()");
    expect(text).toContain("attempt_count < 8");
  });

  it("stops a processing unit without incrementing attempts", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "unit-1" }] });

    await expect(stopReadingIngestUnit("user-1", "unit-1")).resolves.toBe(true);

    const query = queryMock.mock.calls[0][0] as SqlQuery;
    const text = extractSqlText(query);
    expect(text).toContain("error =");
    expect(text).toContain("next_attempt_at = NOW()");
    expect(text).toContain("claimed_at = NULL");
    expect(text).toContain("DELETE FROM readmax.reading_agent_lease");
    expect(text).not.toContain("attempt_count = attempt_count + 1");
    expect(extractValues(query)).toEqual([
      "Stopped from debug",
      "user-1",
      "unit-1",
      "user-1",
      "unit-1",
    ]);
  });

  it("records a caller-provided reason when stopping a processing unit", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "unit-1" }] });

    await expect(
      stopReadingIngestUnit("user-1", "unit-1", "Reading agent host lost"),
    ).resolves.toBe(true);

    expect(extractValues(queryMock.mock.calls[0][0] as SqlQuery)).toContain(
      "Reading agent host lost",
    );
  });

  it("retries a user-owned unit immediately without incrementing attempts", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: "unit-1", status: "error", lastError: "boom" }],
      })
      .mockResolvedValueOnce({ rows: [{ id: "unit-1" }] });

    await expect(getReadingIngestUnitForUser("user-1", "unit-1")).resolves.toMatchObject({
      id: "unit-1",
      status: "error",
    });
    await expect(retryReadingIngestUnit("user-1", "unit-1")).resolves.toBe(true);

    const lookup = queryMock.mock.calls[0][0] as SqlQuery;
    const retry = queryMock.mock.calls[1][0] as SqlQuery;
    expect(extractValues(lookup)).toEqual(["user-1", "unit-1"]);
    expect(extractSqlText(lookup)).not.toContain("text");
    expect(extractSqlText(retry)).toContain("error = NULL");
    expect(extractSqlText(retry)).toContain("next_attempt_at = NOW()");
    expect(extractSqlText(retry)).not.toContain("attempt_count = attempt_count + 1");
  });

  it("resets an 8/8 user-owned unit by skipping it and releasing its lease", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "unit-1" }] });

    await expect(resetReadingIngestUnit("user-1", "unit-1")).resolves.toBe(true);

    const reset = queryMock.mock.calls[0][0] as SqlQuery;
    const resetText = extractSqlText(reset);
    expect(resetText).toContain("status = 'skipped'");
    expect(resetText).toContain("attempt_count = 0");
    expect(resetText).toContain("error = NULL");
    expect(resetText).toContain("claimed_at = NULL");
    expect(resetText).toContain("DELETE FROM readmax.reading_agent_lease");
    expect(extractValues(reset)).toEqual(["user-1", "unit-1", "user-1", "unit-1"]);
  });

  it("reports when reset does not update a unit", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(resetReadingIngestUnit("user-1", "unit-1")).resolves.toBe(false);
  });

  it("clears only one user's artifacts, revisions, usage, leases, and ingest units", async () => {
    clientQueryMock.mockResolvedValue({ rows: [] });

    await expect(clearReadingArtifactsAndIngestForUser("user-1")).resolves.toBeUndefined();

    expect(clientQueryMock).toHaveBeenNthCalledWith(1, "BEGIN");
    const deletes = clientQueryMock.mock.calls.slice(1, 6).map(([query]) => query as SqlQuery);
    expect(deletes.map(extractSqlText)).toEqual([
      expect.stringContaining("DELETE FROM readmax.reading_artifact"),
      expect.stringContaining("DELETE FROM readmax.reading_artifact_revision"),
      expect.stringContaining("DELETE FROM readmax.reading_agent_usage"),
      expect.stringContaining("DELETE FROM readmax.reading_agent_lease"),
      expect.stringContaining("DELETE FROM readmax.reading_ingest_unit"),
    ]);
    expect(deletes.map(extractValues)).toEqual([
      ["user-1"],
      ["user-1"],
      ["user-1"],
      ["user-1"],
      ["user-1"],
    ]);
    expect(clientQueryMock).toHaveBeenNthCalledWith(7, "COMMIT");
    expect(releaseMock).toHaveBeenCalledOnce();
  });

  it("reclaims an expired lease and stale processing unit", async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ unitId: "unit-1" }] })
      .mockResolvedValueOnce({ rows: [{ id: "unit-1" }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(reclaimExpiredReadingAgentLease("user-1")).resolves.toBe(1);

    const reclaim = clientQueryMock.mock.calls[2][0] as SqlQuery;
    expect(extractSqlText(reclaim)).toContain("attempt_count = attempt_count + 1");
    expect(extractSqlText(reclaim)).toContain("claimed_at <= NOW()");
    expect(extractSqlText(reclaim)).toContain("LEAST(300, 10 * POWER(2, attempt_count))");
  });

  it("calculates exponential retry backoff capped at five minutes", () => {
    expect(readingAgentRetryDelaySeconds(1)).toBe(10);
    expect(readingAgentRetryDelaySeconds(2)).toBe(20);
    expect(readingAgentRetryDelaySeconds(5)).toBe(160);
    expect(readingAgentRetryDelaySeconds(6)).toBe(300);
    expect(readingAgentRetryDelaySeconds(8)).toBe(300);
  });

  it("releases a failed unit and its lease together", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const claim = {
      unit: { id: "unit-1", attemptCount: 0 },
      lease: {
        userId: "user-1",
        unitId: "unit-1",
        bookId: "book-1",
        expiresAt: new Date("2026-01-01T00:05:00Z"),
      },
    };

    await expect(
      releaseReadingIngestUnit(
        claim as Parameters<typeof releaseReadingIngestUnit>[0],
        "Flue unavailable",
        unknownUsage,
      ),
    ).resolves.toBeUndefined();

    const query = queryMock.mock.calls[0][0] as SqlQuery;
    const text = extractSqlText(query);
    expect(text).toContain("WITH released AS");
    expect(text).toContain("attempt_count = attempt_count + 1");
    expect(text).toContain("INSERT INTO readmax.reading_agent_usage");
    expect(text).toContain("DELETE FROM readmax.reading_agent_lease");
    expect(text).toContain("expires_at > NOW()");
    expect(text).not.toContain("expires_at =");
    expect(extractValues(query).slice(0, 2)).toEqual(["pending", 10]);
    expect(extractValues(query)).not.toContain(claim.lease.expiresAt.toISOString());
  });

  it("records failed-call usage independently of an expired lease fence", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const claim = {
      unit: { id: "unit-1", attemptCount: 0 },
      lease: {
        userId: "user-1",
        unitId: "unit-1",
        bookId: "book-1",
        expiresAt: new Date("2026-01-01T00:05:00Z"),
      },
    };

    await releaseReadingIngestUnit(
      claim as Parameters<typeof releaseReadingIngestUnit>[0],
      "Invalid reply",
      unknownUsage,
    );

    const query = queryMock.mock.calls[0][0] as SqlQuery;
    const text = extractSqlText(query);
    const usageInsert = text.slice(
      text.indexOf("INSERT INTO readmax.reading_agent_usage"),
      text.indexOf("RETURNING unit_id"),
    );
    expect(usageInsert).not.toContain("FROM released");
    expect(extractValues(query)).toContain(true);
  });

  it("skips usage recording when failure happens before the remote call", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const claim = {
      unit: { id: "unit-1", attemptCount: 0 },
      lease: {
        userId: "user-1",
        unitId: "unit-1",
        bookId: "book-1",
        expiresAt: new Date("2026-01-01T00:05:00Z"),
      },
    };

    await releaseReadingIngestUnit(
      claim as Parameters<typeof releaseReadingIngestUnit>[0],
      "Artifact read failed",
    );

    const query = queryMock.mock.calls[0][0] as SqlQuery;
    expect(extractValues(query)).toContain(false);
  });

  it("marks the eighth failed attempt terminal", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const claim = {
      unit: { id: "unit-1", attemptCount: 7 },
      lease: {
        userId: "user-1",
        unitId: "unit-1",
        bookId: "book-1",
        expiresAt: new Date("2026-01-01T00:05:00Z"),
      },
    };

    await releaseReadingIngestUnit(
      claim as Parameters<typeof releaseReadingIngestUnit>[0],
      "Still unavailable",
      unknownUsage,
    );

    const query = queryMock.mock.calls[0][0] as SqlQuery;
    expect(extractValues(query).slice(0, 2)).toEqual(["error", 300]);
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

  it("finds an existing locator and prefers a completed unit", async () => {
    const unit = { id: "unit-1", status: "done" };
    queryMock.mockResolvedValueOnce({ rows: [unit] });

    await expect(
      getReadingIngestUnitByLocator("user-1", "book-1", "chapter.xhtml#page=2"),
    ).resolves.toBe(unit);

    const query = queryMock.mock.calls[0][0] as SqlQuery;
    expect(extractValues(query)).toEqual(["user-1", "book-1", "chapter.xhtml#page=2"]);
    expect(extractSqlText(query)).toContain("WHEN 'done' THEN 0");
    expect(extractSqlText(query)).toContain("LIMIT 1");
  });

  it("refreshes text only while an existing locator is pending or errored", async () => {
    const unit = { id: "unit-1", status: "pending", text: "Jittered page text" };
    queryMock.mockResolvedValueOnce({ rows: [unit] });

    await expect(
      refreshReadingIngestUnit({
        userId: "user-1",
        bookId: "book-1",
        unitId: "unit-1",
        chapterLabel: "Chapter 1",
        text: "Jittered page text",
      }),
    ).resolves.toBe(unit);

    const query = queryMock.mock.calls[0][0] as SqlQuery;
    expect(extractSqlText(query)).toContain("status IN ('pending', 'error')");
    expect(extractSqlText(query)).toContain("last_seen_at = NOW()");
    expect(extractValues(query)).toEqual([
      "Jittered page text",
      "Chapter 1",
      "unit-1",
      "user-1",
      "book-1",
    ]);
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

  it("atomically creates a revision, advances its head, and completes a live unit", async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "unit-1" }] })
      .mockResolvedValueOnce({ rows: [{ content: "Old story", revisionId: "revision-1" }] })
      .mockResolvedValueOnce({ rows: [{ id: "revision-2" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
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
    const lease = {
      unit,
      lease: {
        userId: "user-1",
        unitId: "unit-1",
        bookId: "book-1",
        expiresAt: new Date("2026-01-01T00:05:00Z"),
      },
    };

    await expect(
      completeReadingIngestUnit(
        lease,
        [{ kind: "wiki", content: "New story", summary: "Added the scene" }],
        unknownUsage,
      ),
    ).resolves.toBe(1);

    const revision = clientQueryMock.mock.calls[3][0] as SqlQuery;
    expect(extractSqlText(revision)).toContain("previous_revision_id, actor");
    expect(extractSqlText(revision)).toContain("'agent'");
    expect(extractValues(revision)).toContain("revision-1");
    expect(extractValues(revision)).toContain("fingerprint-1");
    const usage = clientQueryMock.mock.calls[5][0] as SqlQuery;
    expect(extractSqlText(usage)).toContain("INSERT INTO readmax.reading_agent_usage");
    const leaseDelete = clientQueryMock.mock.calls[7][0] as SqlQuery;
    expect(extractSqlText(leaseDelete)).toContain("DELETE FROM readmax.reading_agent_lease");
    const fence = clientQueryMock.mock.calls[1][0] as SqlQuery;
    expect(extractSqlText(fence)).toContain("expires_at > NOW()");
    expect(clientQueryMock).toHaveBeenNthCalledWith(9, "COMMIT");
    expect(releaseMock).toHaveBeenCalledOnce();
  });

  it("completes despite millisecond versus microsecond lease precision", async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "unit-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const expiresAt = new Date("2026-01-01T00:05:00.123Z");
    const claim = {
      unit: {
        id: "unit-1",
        userId: "user-1",
        bookId: "book-1",
        fingerprint: "fingerprint-1",
      },
      lease: { userId: "user-1", unitId: "unit-1", bookId: "book-1", expiresAt },
    };

    await expect(
      completeReadingIngestUnit(
        claim as Parameters<typeof completeReadingIngestUnit>[0],
        [],
        unknownUsage,
      ),
    ).resolves.toBe(0);

    const fence = clientQueryMock.mock.calls[1][0] as SqlQuery;
    expect(extractSqlText(fence)).toContain("expires_at > NOW()");
    expect(extractSqlText(fence)).not.toContain("expires_at =");
    expect(extractValues(fence)).not.toContain(expiresAt.toISOString());
  });

  it("records usage without applying artifacts when the lease is stale or expired", async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const claim = {
      unit: {
        id: "unit-1",
        userId: "user-1",
        bookId: "book-1",
        fingerprint: "fingerprint-1",
      },
      lease: {
        userId: "user-1",
        unitId: "unit-1",
        bookId: "book-1",
        expiresAt: new Date("2026-01-01T00:05:00Z"),
      },
    };

    await expect(
      completeReadingIngestUnit(
        claim as Parameters<typeof completeReadingIngestUnit>[0],
        [{ kind: "wiki", content: "Stale story", summary: "Must not apply" }],
        unknownUsage,
      ),
    ).resolves.toBeNull();

    const usage = clientQueryMock.mock.calls[2][0] as SqlQuery;
    expect(extractSqlText(usage)).toContain("INSERT INTO readmax.reading_agent_usage");
    const fence = clientQueryMock.mock.calls[1][0] as SqlQuery;
    expect(extractSqlText(fence)).toContain("status = 'processing'");
    expect(extractSqlText(fence)).toContain("expires_at > NOW()");
    expect(clientQueryMock).toHaveBeenCalledTimes(4);
    expect(clientQueryMock).toHaveBeenNthCalledWith(4, "COMMIT");
    expect(releaseMock).toHaveBeenCalledOnce();
  });
});
