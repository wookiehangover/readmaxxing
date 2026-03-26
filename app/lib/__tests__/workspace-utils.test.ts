import { describe, it, expect } from "vitest";
import { truncateTitle, sortBooks } from "~/lib/workspace-utils";
import type { Book } from "~/lib/book-store";

function makeBook(overrides: Partial<Book> & { id: string; title: string; author: string }): Book {
  return {
    coverImage: null,
    data: new ArrayBuffer(0),
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
