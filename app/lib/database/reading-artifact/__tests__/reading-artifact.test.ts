import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());

vi.mock("../../pool", () => ({
  getPool: () => ({ query: queryMock }),
}));

import {
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

beforeEach(() => {
  queryMock.mockReset();
});

describe("reading artifact persistence", () => {
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
});
