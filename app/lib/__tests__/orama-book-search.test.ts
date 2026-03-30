import { describe, it, expect, beforeEach } from "vitest";
import {
  buildBookIndex,
  searchBook,
  getOrBuildBookIndex,
  clearBookIndexCache,
} from "~/lib/orama-book-search";
import type { BookChapter } from "~/lib/epub-text-extract";

function makeChapter(overrides: Partial<BookChapter> & { index: number }): BookChapter {
  return {
    title: `Chapter ${overrides.index + 1}`,
    text: "",
    ...overrides,
  };
}

describe("buildBookIndex", () => {
  it("builds an index from multiple chapters", () => {
    const chapters: BookChapter[] = [
      makeChapter({ index: 0, title: "Introduction", text: "Welcome to the book." }),
      makeChapter({ index: 1, title: "Body", text: "The main content goes here." }),
    ];
    const db = buildBookIndex(chapters);
    const results = searchBook(db, "Welcome");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].chapterTitle).toBe("Introduction");
  });

  it("handles empty chapters array", () => {
    const db = buildBookIndex([]);
    const results = searchBook(db, "anything");
    expect(results).toEqual([]);
  });

  it("handles chapters with empty text", () => {
    const chapters: BookChapter[] = [
      makeChapter({ index: 0, text: "" }),
      makeChapter({ index: 1, text: "   " }),
    ];
    const db = buildBookIndex(chapters);
    const results = searchBook(db, "anything");
    expect(results).toEqual([]);
  });
});

describe("searchBook — exact matching", () => {
  const chapters: BookChapter[] = [
    makeChapter({
      index: 0,
      title: "Philosophy",
      text: "The study of philosophy examines fundamental questions about existence, knowledge, and ethics.",
    }),
    makeChapter({
      index: 1,
      title: "Science",
      text: "Science relies on empirical evidence and the scientific method to understand the natural world.",
    }),
  ];

  it("finds exact text across multiple chapters", () => {
    const db = buildBookIndex(chapters);
    const results = searchBook(db, "philosophy");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].chapterIndex).toBe(0);
  });

  it("returns correct chapterIndex and chapterTitle", () => {
    const db = buildBookIndex(chapters);
    const results = searchBook(db, "empirical");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].chapterIndex).toBe(1);
    expect(results[0].chapterTitle).toBe("Science");
  });

  it("excerpt contains surrounding context with ellipsis markers for long text", () => {
    // Build a chapter with enough text that the match won't be at the boundaries
    const prefix = "A".repeat(300);
    const suffix = "B".repeat(300);
    const longChapter = makeChapter({
      index: 0,
      title: "Long",
      text: `${prefix} uniqueSearchTerm ${suffix}`,
    });
    const db = buildBookIndex([longChapter]);
    const results = searchBook(db, "uniqueSearchTerm");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].excerpt).toContain("uniqueSearchTerm");
    // The excerpt should have ellipsis at start since the match is deep in the text
    expect(results[0].excerpt.startsWith("…")).toBe(true);
    expect(results[0].excerpt.endsWith("…")).toBe(true);
  });

  it("respects the limit parameter", () => {
    // Create many chapters with the same searchable word
    const manyChapters = Array.from({ length: 10 }, (_, i) =>
      makeChapter({
        index: i,
        title: `Chapter ${i + 1}`,
        text: `This chapter discusses knowledge and understanding in depth.`,
      }),
    );
    const db = buildBookIndex(manyChapters);
    const results = searchBook(db, "knowledge", 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});

describe("searchBook — fuzzy/typo-tolerant matching", () => {
  const chapters: BookChapter[] = [
    makeChapter({
      index: 0,
      title: "Philosophy",
      text: "The study of philosophy has shaped human thought for millennia.",
    }),
  ];

  it("finds results with 1-character typo", () => {
    const db = buildBookIndex(chapters);
    // "philsophy" is a typo for "philosophy"
    const results = searchBook(db, "philsophy");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].chapterIndex).toBe(0);
  });

  it("fuzzy match excerpts fall back to chunk start when no exact substring found", () => {
    const db = buildBookIndex(chapters);
    const results = searchBook(db, "philsophy");
    expect(results.length).toBeGreaterThanOrEqual(1);
    // The excerpt should start from the beginning of the chunk text since
    // "philsophy" won't be found as an exact substring
    const chunkText = chapters[0].text;
    expect(results[0].excerpt).toBe(chunkText);
  });
});

describe("searchBook — edge cases", () => {
  it("returns empty array for no matches", () => {
    const chapters: BookChapter[] = [
      makeChapter({ index: 0, text: "Cats and dogs are popular pets." }),
    ];
    const db = buildBookIndex(chapters);
    const results = searchBook(db, "xylophone");
    expect(results).toEqual([]);
  });

  it("handles single-word queries", () => {
    const chapters: BookChapter[] = [
      makeChapter({ index: 0, text: "The elephant walked through the jungle." }),
    ];
    const db = buildBookIndex(chapters);
    const results = searchBook(db, "elephant");
    expect(results.length).toBe(1);
    expect(results[0].excerpt).toContain("elephant");
  });

  it("handles queries longer than any chunk", () => {
    const chapters: BookChapter[] = [makeChapter({ index: 0, text: "Short text." })];
    const db = buildBookIndex(chapters);
    // Orama matches on individual tokens, so a long query with no matching
    // words should return empty results
    const longQuery = "xyzzy foobaz quuxwaldo plughthud";
    const results = searchBook(db, longQuery);
    expect(results).toEqual([]);
  });
});

describe("chunking behavior (tested indirectly through search)", () => {
  it("long chapters are chunked — search returns granular results", () => {
    // Create a chapter with two distinct paragraphs, each well over 500 chars
    const para1 = "Alpha paragraph. ".repeat(50); // ~850 chars
    const para2 = "Beta paragraph. ".repeat(50); // ~850 chars
    const longChapter = makeChapter({
      index: 0,
      title: "Long Chapter",
      text: `${para1}\n\n${para2}`,
    });
    const db = buildBookIndex([longChapter]);

    // Search for "Alpha" — should only match the first chunk, not the whole chapter
    const alphaResults = searchBook(db, "Alpha");
    expect(alphaResults.length).toBeGreaterThanOrEqual(1);
    expect(alphaResults[0].excerpt).toContain("Alpha");
    // The excerpt should NOT contain "Beta" since it's in a different chunk
    expect(alphaResults[0].excerpt).not.toContain("Beta");
  });

  it("short chapters are kept as single chunks", () => {
    const shortChapter = makeChapter({
      index: 0,
      title: "Short Chapter",
      text: "A brief chapter with just one sentence.",
    });
    const db = buildBookIndex([shortChapter]);
    const results = searchBook(db, "brief");
    expect(results.length).toBe(1);
    // The whole chapter text should be in the excerpt since it's a single chunk
    expect(results[0].excerpt).toBe("A brief chapter with just one sentence.");
  });
});

describe("getOrBuildBookIndex — caching", () => {
  beforeEach(() => {
    clearBookIndexCache();
  });

  it("returns a working index on first call", () => {
    const chapters: BookChapter[] = [
      makeChapter({ index: 0, title: "Intro", text: "Welcome to the adventure." }),
    ];
    const db = getOrBuildBookIndex(chapters);
    const results = searchBook(db, "Welcome");
    expect(results.length).toBe(1);
    expect(results[0].chapterTitle).toBe("Intro");
  });

  it("returns the same index instance for identical chapters (cache hit)", () => {
    const chapters: BookChapter[] = [
      makeChapter({ index: 0, title: "Intro", text: "Welcome to the adventure." }),
    ];
    const db1 = getOrBuildBookIndex(chapters);
    const db2 = getOrBuildBookIndex(chapters);
    expect(db1).toBe(db2);
  });

  it("rebuilds the index when chapters change (cache miss)", () => {
    const chaptersA: BookChapter[] = [
      makeChapter({ index: 0, title: "Intro", text: "Welcome to the adventure." }),
    ];
    const chaptersB: BookChapter[] = [
      makeChapter({ index: 0, title: "Preface", text: "This is a different book entirely." }),
    ];
    const dbA = getOrBuildBookIndex(chaptersA);
    const dbB = getOrBuildBookIndex(chaptersB);
    expect(dbA).not.toBe(dbB);

    // The new index should search the new content
    const results = searchBook(dbB, "different");
    expect(results.length).toBe(1);
    expect(results[0].chapterTitle).toBe("Preface");
  });

  it("evicts old cache when a new book is indexed (LRU-1)", () => {
    const chaptersA: BookChapter[] = [
      makeChapter({ index: 0, title: "Book A", text: "Alpha content here." }),
    ];
    const chaptersB: BookChapter[] = [
      makeChapter({ index: 0, title: "Book B", text: "Beta content here." }),
    ];
    const dbA = getOrBuildBookIndex(chaptersA);
    getOrBuildBookIndex(chaptersB);

    // Going back to chaptersA should produce a new instance (old one was evicted)
    const dbA2 = getOrBuildBookIndex(chaptersA);
    expect(dbA2).not.toBe(dbA);
  });

  it("clearBookIndexCache forces a rebuild", () => {
    const chapters: BookChapter[] = [
      makeChapter({ index: 0, title: "Intro", text: "Welcome to the adventure." }),
    ];
    const db1 = getOrBuildBookIndex(chapters);
    clearBookIndexCache();
    const db2 = getOrBuildBookIndex(chapters);
    expect(db1).not.toBe(db2);
  });
});
