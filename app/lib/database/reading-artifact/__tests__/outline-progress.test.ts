import { beforeEach, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("../../pool", () => ({ getPool: () => ({ query }) }));
import { listPendingOutlinePages } from "../outline-progress";

beforeEach(() => query.mockReset());

it("scopes active pages to the reader and book and excludes finished or failed work", async () => {
  query.mockResolvedValue({ rows: [] });
  expect(await listPendingOutlinePages("user-1", "book-1")).toEqual([]);
  const items = query.mock.calls[0][0]._items as { type: string; text?: string; value?: unknown }[];
  expect(items.filter((item) => item.type === "VALUE").map((item) => item.value)).toEqual([
    "user-1",
    "book-1",
  ]);
  expect(
    items
      .filter((item) => item.type === "RAW")
      .map((item) => item.text)
      .join(""),
  ).toContain("status IN ('pending', 'processing')");
});

it("uses display pages first and falls back to PDF/EPUB locators", async () => {
  query.mockResolvedValue({
    rows: [
      { unitId: "a", locator: "chapter.xhtml#page=3", displayPage: 12, status: "processing" },
      { unitId: "b", locator: "page:4", displayPage: null, status: "pending" },
      { unitId: "c", locator: "chapter.xhtml#page=5", displayPage: null, status: "pending" },
      { unitId: "d", locator: "chapter.xhtml", displayPage: null, status: "pending" },
      { unitId: "e", locator: "page:0", displayPage: null, status: "pending" },
    ],
  });
  expect((await listPendingOutlinePages("user-1", "book-1")).map((page) => page.page)).toEqual([
    12,
    4,
    5,
    null,
    null,
  ]);
});
