import { beforeEach, describe, expect, it, vi } from "vitest";

const connectMock = vi.hoisted(() => vi.fn());

vi.mock("../pool", () => ({
  getPool: () => ({ connect: connectMock }),
}));

import { upsertPosition, type ReadingPositionRow } from "../book/reading-position";

function positionRow(cfi: string, updatedAt: Date): ReadingPositionRow {
  return { userId: "user-1", bookId: "book-1", cfi, updatedAt };
}

function createClient(existing: ReadingPositionRow, replacement?: ReadingPositionRow) {
  const query = vi
    .fn()
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ rows: [existing] });
  if (replacement) query.mockResolvedValueOnce({ rows: [replacement] });
  query.mockResolvedValueOnce({});
  const client = { query, release: vi.fn() };
  connectMock.mockResolvedValue(client);
  return client;
}

beforeEach(() => {
  connectMock.mockReset();
});

describe("upsertPosition", () => {
  it.each([
    ["EPUB CFI", "epubcfi(/6/4!/4/2/2)", "epubcfi(/6/4!/4/4/2)"],
    ["PDF page", "page:2", "page:12"],
  ])("accepts further-but-older %s content", async (_label, earlier, further) => {
    const existing = positionRow(earlier, new Date("2026-01-02T00:00:00.000Z"));
    const replacement = positionRow(further, new Date("2026-01-01T00:00:00.000Z"));
    const client = createClient(existing, replacement);

    await expect(
      upsertPosition("user-1", "book-1", further, replacement.updatedAt),
    ).resolves.toEqual(replacement);
    expect(client.query).toHaveBeenCalledTimes(5);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it.each([
    ["EPUB CFI", "epubcfi(/6/4!/4/2/2)", "epubcfi(/6/4!/4/4/2)"],
    ["PDF page", "page:2", "page:12"],
  ])("rejects earlier-but-newer %s content", async (_label, earlier, further) => {
    const existing = positionRow(further, new Date("2026-01-01T00:00:00.000Z"));
    const client = createClient(existing);

    await expect(
      upsertPosition("user-1", "book-1", earlier, new Date("2026-01-02T00:00:00.000Z")),
    ).resolves.toBeNull();
    expect(client.query).toHaveBeenCalledTimes(4);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("uses the timestamp when positions are equal", async () => {
    const cfi = "page:12";
    const existing = positionRow(cfi, new Date("2026-01-01T00:00:00.000Z"));
    const replacement = positionRow(cfi, new Date("2026-01-02T00:00:00.000Z"));
    const client = createClient(existing, replacement);

    await expect(upsertPosition("user-1", "book-1", cfi, replacement.updatedAt)).resolves.toEqual(
      replacement,
    );
    expect(client.query).toHaveBeenCalledTimes(5);
  });
});
