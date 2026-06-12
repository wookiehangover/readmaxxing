import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  clampNullableTimestamp,
  clampUpdatedAt,
  DEFAULT_UPDATED_AT_SKEW_MS,
} from "../clamp-timestamp";

// ---------------------------------------------------------------------------
// clampUpdatedAt — pure function
// ---------------------------------------------------------------------------

describe("clampUpdatedAt", () => {
  const FIXED_NOW = new Date("2026-01-15T12:00:00.000Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the client timestamp unchanged when it is within the skew window", () => {
    const ts = new Date(FIXED_NOW - 1000);
    expect(clampUpdatedAt(ts)).toBe(ts.toISOString());
  });

  it("returns the client timestamp when it is exactly at NOW", () => {
    const ts = new Date(FIXED_NOW);
    expect(clampUpdatedAt(ts)).toBe(ts.toISOString());
  });

  it("allows a legitimate small positive skew (2 minutes)", () => {
    const ts = new Date(FIXED_NOW + 2 * 60 * 1000);
    expect(clampUpdatedAt(ts)).toBe(ts.toISOString());
  });

  it("clamps a far-future client timestamp (year 9999) to NOW + skew", () => {
    const year9999 = new Date("9999-12-31T23:59:59.000Z");
    const result = clampUpdatedAt(year9999);
    const expected = new Date(FIXED_NOW + DEFAULT_UPDATED_AT_SKEW_MS).toISOString();
    expect(result).toBe(expected);
  });

  it("clamps a timestamp beyond the skew boundary to NOW + skew", () => {
    const ts = new Date(FIXED_NOW + DEFAULT_UPDATED_AT_SKEW_MS + 1);
    const result = clampUpdatedAt(ts);
    const expected = new Date(FIXED_NOW + DEFAULT_UPDATED_AT_SKEW_MS).toISOString();
    expect(result).toBe(expected);
  });

  it("falls back to NOW when given null", () => {
    expect(clampUpdatedAt(null)).toBe(new Date(FIXED_NOW).toISOString());
  });

  it("falls back to NOW when given undefined", () => {
    expect(clampUpdatedAt(undefined)).toBe(new Date(FIXED_NOW).toISOString());
  });

  it("falls back to NOW when given an invalid Date", () => {
    expect(clampUpdatedAt(new Date("not a date"))).toBe(new Date(FIXED_NOW).toISOString());
  });

  it("respects a custom skew value", () => {
    const oneSecondSkew = 1000;
    const ts = new Date(FIXED_NOW + 10_000);
    const result = clampUpdatedAt(ts, oneSecondSkew);
    expect(result).toBe(new Date(FIXED_NOW + oneSecondSkew).toISOString());
  });
});

// ---------------------------------------------------------------------------
// clampNullableTimestamp — pure function
// ---------------------------------------------------------------------------

describe("clampNullableTimestamp", () => {
  const FIXED_NOW = new Date("2026-01-15T12:00:00.000Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("preserves null (e.g. a live row's deleted_at)", () => {
    expect(clampNullableTimestamp(null)).toBeNull();
  });

  it("preserves undefined", () => {
    expect(clampNullableTimestamp(undefined)).toBeNull();
  });

  it("returns a past timestamp unchanged", () => {
    const ts = new Date(FIXED_NOW - 60_000);
    expect(clampNullableTimestamp(ts)).toBe(ts.toISOString());
  });

  it("clamps a far-future tombstone to NOW + skew", () => {
    const year9999 = new Date("9999-12-31T23:59:59.000Z");
    const expected = new Date(FIXED_NOW + DEFAULT_UPDATED_AT_SKEW_MS).toISOString();
    expect(clampNullableTimestamp(year9999)).toBe(expected);
  });

  it("falls back to NOW for an invalid Date (delete intent is clear)", () => {
    expect(clampNullableTimestamp(new Date("not a date"))).toBe(new Date(FIXED_NOW).toISOString());
  });
});

// ---------------------------------------------------------------------------
// upsertBook — verifies the clamp is actually applied end-to-end through the
// DB helper. The pool is mocked so we can inspect the SQL parameters that
// would be bound to Postgres.
// ---------------------------------------------------------------------------

const queryMock = vi.fn();
vi.mock("../pool", () => ({
  getPool: () => ({ query: queryMock }),
}));

import { upsertBook } from "../book/book";

type SqlQuery = { _items: Array<{ type: string; value?: unknown; text?: string }> };

function extractValues(query: SqlQuery): unknown[] {
  return query._items.filter((i) => i.type === "VALUE").map((i) => i.value);
}

function extractSqlText(query: SqlQuery): string {
  return query._items
    .filter((i) => i.type === "RAW")
    .map((i) => i.text)
    .join("");
}

describe("upsertBook (clamped updated_at)", () => {
  const FIXED_NOW = new Date("2026-01-15T12:00:00.000Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    queryMock.mockReset();
    queryMock.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes a clamped updated_at when the client supplies year 9999", async () => {
    const bogusFuture = new Date("9999-12-31T23:59:59.000Z");
    await upsertBook("user-1", {
      id: "book-1",
      title: "T",
      author: "A",
      format: "epub",
      fileHash: "abc",
      updatedAt: bogusFuture,
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const boundValues = extractValues(queryMock.mock.calls[0][0]);
    const updatedAtParam = boundValues[6];
    const expectedIso = new Date(FIXED_NOW + DEFAULT_UPDATED_AT_SKEW_MS).toISOString();
    expect(updatedAtParam).toBe(expectedIso);
  });

  it("passes through a reasonable client updated_at unchanged", async () => {
    const reasonable = new Date(FIXED_NOW - 60_000);
    await upsertBook("user-1", {
      id: "book-1",
      updatedAt: reasonable,
    });

    const boundValues = extractValues(queryMock.mock.calls[0][0]);
    expect(boundValues[6]).toBe(reasonable.toISOString());
  });

  it("writes deleted_at as null for restored books and applies it on LWW update", async () => {
    await upsertBook("user-1", {
      id: "book-1",
      updatedAt: new Date(FIXED_NOW),
      deletedAt: null,
    });

    const query = queryMock.mock.calls[0][0] as SqlQuery;
    const boundValues = extractValues(query);
    expect(boundValues[7]).toBeNull();
    expect(boundValues[8]).toBe(true);
    expect(extractSqlText(query)).toContain("THEN EXCLUDED.deleted_at");
    expect(extractSqlText(query)).toContain("WHERE EXCLUDED.updated_at > readmax.book.updated_at");
  });

  it("writes deleted_at for soft-deleted books", async () => {
    const deletedAt = new Date(FIXED_NOW - 30_000);
    await upsertBook("user-1", {
      id: "book-1",
      updatedAt: new Date(FIXED_NOW),
      deletedAt,
    });

    const boundValues = extractValues(queryMock.mock.calls[0][0] as SqlQuery);
    expect(boundValues[7]).toBe(deletedAt.toISOString());
    expect(boundValues[8]).toBe(true);
  });

  it("leaves deleted_at unchanged on conflict when deletedAt is omitted", async () => {
    await upsertBook("user-1", {
      id: "book-1",
      updatedAt: new Date(FIXED_NOW),
    });

    const query = queryMock.mock.calls[0][0] as SqlQuery;
    const boundValues = extractValues(query);
    expect(boundValues[7]).toBeNull();
    expect(boundValues[8]).toBe(false);
    expect(extractSqlText(query)).toContain("ELSE readmax.book.deleted_at");
  });

  it("allows same-timestamp live restores of existing tombstones", async () => {
    await upsertBook("user-1", {
      id: "book-1",
      updatedAt: new Date(FIXED_NOW),
      deletedAt: null,
    });

    const query = queryMock.mock.calls[0][0] as SqlQuery;
    const sqlText = extractSqlText(query);
    expect(sqlText).toContain("EXCLUDED.updated_at = readmax.book.updated_at");
    expect(sqlText).toContain("EXCLUDED.deleted_at IS NULL");
    expect(sqlText).toContain("readmax.book.deleted_at IS NOT NULL");
  });
});
