import { describe, it, expect } from "vitest";
import { truncateTitle, sortBooks, sortBooksForTable, filterBooks } from "~/lib/workspace-utils";
import type { BookMeta } from "~/lib/stores/book-store";

function makeBook(
  overrides: Partial<BookMeta> & { id: string; title: string; author: string },
): BookMeta {
  return {
    coverImage: null,
    format: "epub" as const,
    ...overrides,
  };
}

describe("truncateTitle", () => {
  it("returns title unchanged when shorter than maxLength", () => {
    expect(truncateTitle("Short Title")).toBe("Short Title");
  });

  it("returns title unchanged when exactly maxLength", () => {
    const title = "a".repeat(30);
    expect(truncateTitle(title)).toBe(title);
  });

  it("truncates and appends ellipsis when longer than maxLength", () => {
    const title = "a".repeat(35);
    expect(truncateTitle(title)).toBe("a".repeat(30) + "…");
  });

  it("respects custom maxLength", () => {
    expect(truncateTitle("Hello World", 5)).toBe("Hello…");
  });

  it("handles empty string", () => {
    expect(truncateTitle("")).toBe("");
  });
});

describe("sortBooks", () => {
  const bookA = makeBook({ id: "1", title: "Alpha", author: "Zara" });
  const bookB = makeBook({ id: "2", title: "Beta", author: "Alice" });
  const bookC = makeBook({ id: "3", title: "Charlie", author: "Mike" });

  it("sorts by title alphabetically", () => {
    const result = sortBooks([bookC, bookA, bookB], "title", undefined);
    expect(result.map((b) => b.title)).toEqual(["Alpha", "Beta", "Charlie"]);
  });

  it("sorts by author alphabetically", () => {
    const result = sortBooks([bookA, bookC, bookB], "author", undefined);
    expect(result.map((b) => b.author)).toEqual(["Alice", "Mike", "Zara"]);
  });

  it("sorts by recent using lastOpenedMap (most recent first)", () => {
    const map = new Map<string, number>([
      ["1", 100],
      ["2", 300],
      ["3", 200],
    ]);
    const result = sortBooks([bookA, bookB, bookC], "recent", map);
    expect(result.map((b) => b.id)).toEqual(["2", "3", "1"]);
  });

  it("sinks never-opened books to bottom in recent sort", () => {
    const map = new Map<string, number>([["2", 100]]);
    const result = sortBooks([bookA, bookB, bookC], "recent", map);
    expect(result[0].id).toBe("2");
    // bookA and bookC both have 0, so order among them is stable
  });

  it("handles undefined lastOpenedMap for recent sort", () => {
    const result = sortBooks([bookA, bookB, bookC], "recent", undefined);
    // All have timestamp 0, so order is stable (unchanged)
    expect(result).toHaveLength(3);
  });

  it("does not mutate the original array", () => {
    const original = [bookC, bookA, bookB];
    const originalCopy = [...original];
    sortBooks(original, "title", undefined);
    expect(original).toEqual(originalCopy);
  });
});

describe("sortBooksForTable", () => {
  const bookA = makeBook({
    id: "1",
    title: "Alpha",
    author: "Zara",
    format: "epub",
    updatedAt: 300,
  });
  const bookB = makeBook({
    id: "2",
    title: "Beta",
    author: "Alice",
    format: "pdf",
    updatedAt: 100,
  });
  const bookC = makeBook({
    id: "3",
    title: "Charlie",
    author: "Mike",
    format: "epub",
    updatedAt: 200,
  });
  const bookD = makeBook({ id: "4", title: "Delta", author: "Bob", format: "pdf" });

  it("sorts by title asc and desc", () => {
    const asc = sortBooksForTable([bookC, bookA, bookB], "title", "asc", undefined);
    expect(asc.map((b) => b.id)).toEqual(["1", "2", "3"]);
    const desc = sortBooksForTable([bookC, bookA, bookB], "title", "desc", undefined);
    expect(desc.map((b) => b.id)).toEqual(["3", "2", "1"]);
  });

  it("sorts by author asc and desc", () => {
    const asc = sortBooksForTable([bookA, bookB, bookC], "author", "asc", undefined);
    expect(asc.map((b) => b.author)).toEqual(["Alice", "Mike", "Zara"]);
    const desc = sortBooksForTable([bookA, bookB, bookC], "author", "desc", undefined);
    expect(desc.map((b) => b.author)).toEqual(["Zara", "Mike", "Alice"]);
  });

  it("sorts by format asc and desc", () => {
    const asc = sortBooksForTable([bookA, bookB, bookC], "format", "asc", undefined);
    expect(asc.map((b) => b.format)).toEqual(["epub", "epub", "pdf"]);
    const desc = sortBooksForTable([bookA, bookB, bookC], "format", "desc", undefined);
    expect(desc.map((b) => b.format)).toEqual(["pdf", "epub", "epub"]);
  });

  it("sorts by lastOpened desc with never-opened at bottom", () => {
    const map = new Map<string, number>([
      ["1", 100],
      ["2", 300],
      ["3", 200],
    ]);
    const desc = sortBooksForTable([bookA, bookB, bookC, bookD], "lastOpened", "desc", map);
    expect(desc.map((b) => b.id)).toEqual(["2", "3", "1", "4"]);
  });

  it("sorts by lastOpened asc with never-opened at bottom", () => {
    const map = new Map<string, number>([
      ["1", 100],
      ["2", 300],
      ["3", 200],
    ]);
    const asc = sortBooksForTable([bookA, bookB, bookC, bookD], "lastOpened", "asc", map);
    // asc: 100, 200, 300, never (bookD sinks to bottom)
    expect(asc.map((b) => b.id)).toEqual(["1", "3", "2", "4"]);
  });

  it("sorts by updated desc with missing updatedAt at bottom", () => {
    const desc = sortBooksForTable([bookA, bookB, bookC, bookD], "updated", "desc", undefined);
    expect(desc.map((b) => b.id)).toEqual(["1", "3", "2", "4"]);
  });

  it("sorts by updated asc with missing updatedAt at bottom", () => {
    const asc = sortBooksForTable([bookA, bookB, bookC, bookD], "updated", "asc", undefined);
    // asc: 100, 200, 300, then missing
    expect(asc.map((b) => b.id)).toEqual(["2", "3", "1", "4"]);
  });

  it("does not mutate the original array", () => {
    const original = [bookC, bookA, bookB];
    const originalCopy = [...original];
    sortBooksForTable(original, "title", "asc", undefined);
    expect(original).toEqual(originalCopy);
  });
});

describe("filterBooks", () => {
  const bookA = makeBook({ id: "1", title: "The Great Gatsby", author: "F. Scott Fitzgerald" });
  const bookB = makeBook({ id: "2", title: "Moby Dick", author: "Herman Melville" });
  const bookC = makeBook({ id: "3", title: "1984", author: "George Orwell" });

  it("filters by title case-insensitively", () => {
    const result = filterBooks([bookA, bookB, bookC], "great");
    expect(result).toEqual([bookA]);
  });

  it("filters by author case-insensitively", () => {
    const result = filterBooks([bookA, bookB, bookC], "ORWELL");
    expect(result).toEqual([bookC]);
  });

  it("returns empty array when no matches", () => {
    const result = filterBooks([bookA, bookB, bookC], "nonexistent");
    expect(result).toEqual([]);
  });

  it("returns all books for empty query", () => {
    const result = filterBooks([bookA, bookB, bookC], "");
    expect(result).toHaveLength(3);
  });
});
