import { describe, expect, it, vi } from "vitest";

import type { BookChapter } from "~/lib/epub/epub-text-extract";
import type { TextAnchor } from "~/lib/orama-book-search";
import { resolveCreateHighlightAnchor } from "../create-highlight-anchor";

const textAnchor: TextAnchor = {
  chapterIndex: 0,
  snippet: "wrong fuzzy chapter",
  matchQuality: "fuzzy",
};

function chapter(index: number, text: string): BookChapter {
  return {
    index,
    title: `Chapter ${index}`,
    text,
    spineStart: index,
    spineEnd: index + 1,
    segments: [{ spineIndex: index, href: `${index}.xhtml`, start: 0, end: text.length }],
  };
}

describe("resolveCreateHighlightAnchor", () => {
  it("returns an exact CFI when the requested chapter slice matches", async () => {
    const resolveOffsetToCfi = vi.fn().mockResolvedValue("epubcfi(/6/4!/4/2,/1:7,/1:14)");
    const result = await resolveCreateHighlightAnchor(
      {
        chapters: [chapter(0, "wrong fuzzy chapter"), chapter(3, "Before passage after")],
        text: "passage",
        textAnchor,
        fileBlobUrl: "https://example.com/book.epub",
        chapterIndex: 3,
        startOffset: 7,
        endOffset: 14,
      },
      resolveOffsetToCfi,
    );

    expect(result).toMatchObject({
      cfiRange: "epubcfi(/6/4!/4/2,/1:7,/1:14)",
      matchQuality: "exact",
      chapterIndex: 3,
      textAnchor: { chapterIndex: 3, offset: 7, matchQuality: "exact" },
    });
    expect(resolveOffsetToCfi).toHaveBeenCalledOnce();
  });

  it("derives an exact span when endOffset is omitted", async () => {
    const resolveOffsetToCfi = vi.fn().mockResolvedValue("derived-cfi");
    const result = await resolveCreateHighlightAnchor(
      {
        chapters: [chapter(0, "wrong fuzzy chapter"), chapter(3, "Before first\t\t\tsecond after")],
        text: "first second",
        textAnchor,
        fileBlobUrl: "https://example.com/book.epub",
        chapterIndex: 3,
        startOffset: 7,
      },
      resolveOffsetToCfi,
    );

    expect(result).toMatchObject({
      cfiRange: "derived-cfi",
      matchQuality: "exact",
      chapterIndex: 3,
      textAnchor: { chapterIndex: 3, offset: 7, matchQuality: "exact" },
    });
    expect(resolveOffsetToCfi).toHaveBeenCalledWith(
      expect.objectContaining({
        startOffset: 7,
        endOffset: 21,
        expectedText: "first\t\t\tsecond",
      }),
    );
  });

  it("derives an exact span when the provided endOffset is wrong", async () => {
    const resolveOffsetToCfi = vi.fn().mockResolvedValue("derived-cfi");
    const result = await resolveCreateHighlightAnchor(
      {
        chapters: [chapter(0, "wrong fuzzy chapter"), chapter(3, "Before passage after")],
        text: "passage",
        textAnchor,
        fileBlobUrl: "https://example.com/book.epub",
        chapterIndex: 3,
        startOffset: 7,
        endOffset: 13,
      },
      resolveOffsetToCfi,
    );

    expect(result).toMatchObject({ cfiRange: "derived-cfi", matchQuality: "exact" });
    expect(resolveOffsetToCfi).toHaveBeenCalledWith(
      expect.objectContaining({ startOffset: 7, endOffset: 14, expectedText: "passage" }),
    );
  });

  it("uses a verifying startOffset to disambiguate repeated text", async () => {
    const resolveOffsetToCfi = vi.fn().mockResolvedValue("second-cfi");
    const result = await resolveCreateHighlightAnchor(
      {
        chapters: [chapter(0, "passage between passage")],
        text: "passage",
        textAnchor,
        fileBlobUrl: "https://example.com/book.epub",
        chapterIndex: 0,
        startOffset: 16,
      },
      resolveOffsetToCfi,
    );

    expect(result).toMatchObject({ cfiRange: "second-cfi", matchQuality: "exact" });
    expect(resolveOffsetToCfi).toHaveBeenCalledWith(
      expect.objectContaining({ startOffset: 16, endOffset: 23, expectedText: "passage" }),
    );
  });

  it("falls back to fuzzy when the text is not present at or after startOffset", async () => {
    const resolveOffsetToCfi = vi.fn();
    const result = await resolveCreateHighlightAnchor(
      {
        chapters: [chapter(0, "Before passage after")],
        text: "passage",
        textAnchor,
        fileBlobUrl: "https://example.com/book.epub",
        chapterIndex: 0,
        startOffset: 15,
        endOffset: 16,
      },
      resolveOffsetToCfi,
    );

    expect(result).toEqual({
      cfiRange: null,
      matchQuality: "fuzzy",
      chapterIndex: 0,
      textAnchor,
    });
    expect(resolveOffsetToCfi).not.toHaveBeenCalled();
  });

  it("resolves a unique quote without offsets across chapters", async () => {
    const resolveOffsetToCfi = vi.fn().mockResolvedValue("quote-only-cfi");
    const result = await resolveCreateHighlightAnchor(
      {
        chapters: [chapter(0, "wrong fuzzy chapter"), chapter(3, "Before unique passage after")],
        text: "unique passage",
        textAnchor,
        fileBlobUrl: "https://example.com/book.epub",
      },
      resolveOffsetToCfi,
    );

    expect(result).toMatchObject({
      cfiRange: "quote-only-cfi",
      matchQuality: "exact",
      chapterIndex: 3,
      textAnchor: { chapterIndex: 3, offset: 7, matchQuality: "exact" },
    });
    expect(resolveOffsetToCfi).toHaveBeenCalledWith(
      expect.objectContaining({
        startOffset: 7,
        endOffset: 21,
        expectedText: "unique passage",
      }),
    );
  });

  it("returns structured candidates for an ambiguous quote without offsets", async () => {
    const resolveOffsetToCfi = vi.fn();
    const result = await resolveCreateHighlightAnchor(
      {
        chapters: [chapter(0, "passage between passage")],
        text: "passage",
        textAnchor,
        fileBlobUrl: "https://example.com/book.epub",
        chapterIndex: 0,
      },
      resolveOffsetToCfi,
    );

    expect(result).toEqual({
      cfiRange: null,
      matchQuality: "fuzzy",
      chapterIndex: 0,
      textAnchor,
      error: "ambiguous",
      candidates: [
        { chapterIndex: 0, startOffset: 0, endOffset: 7, snippet: "passage" },
        { chapterIndex: 0, startOffset: 16, endOffset: 23, snippet: "passage" },
      ],
    });
    expect(resolveOffsetToCfi).not.toHaveBeenCalled();
  });

  it("does not choose between book-wide quote-only matches when the hint misses", async () => {
    const resolveOffsetToCfi = vi.fn();
    const result = await resolveCreateHighlightAnchor(
      {
        chapters: [
          chapter(0, "wrong fuzzy chapter"),
          chapter(1, "Before passage after"),
          chapter(2, "Another passage here"),
        ],
        text: "passage",
        textAnchor,
        fileBlobUrl: "https://example.com/book.epub",
      },
      resolveOffsetToCfi,
    );

    expect(result).toMatchObject({
      cfiRange: null,
      matchQuality: "fuzzy",
      error: "ambiguous",
      candidates: [
        { chapterIndex: 1, startOffset: 7, endOffset: 14, snippet: "passage" },
        { chapterIndex: 2, startOffset: 8, endOffset: 15, snippet: "passage" },
      ],
    });
    expect(resolveOffsetToCfi).not.toHaveBeenCalled();
  });

  it("falls back to fuzzy when a quote without offsets is missing", async () => {
    const resolveOffsetToCfi = vi.fn();
    const result = await resolveCreateHighlightAnchor(
      {
        chapters: [chapter(0, "wrong fuzzy chapter")],
        text: "missing passage",
        textAnchor,
        fileBlobUrl: "https://example.com/book.epub",
      },
      resolveOffsetToCfi,
    );

    expect(result).toEqual({
      cfiRange: null,
      matchQuality: "fuzzy",
      chapterIndex: 0,
      textAnchor,
    });
    expect(resolveOffsetToCfi).not.toHaveBeenCalled();
  });

  it("maps normalized quote-only whitespace back to the raw range", async () => {
    const resolveOffsetToCfi = vi.fn().mockResolvedValue("whitespace-cfi");
    const result = await resolveCreateHighlightAnchor(
      {
        chapters: [chapter(0, "Before first\t\t\tsecond\n\nthird after")],
        text: "first second third",
        textAnchor,
        fileBlobUrl: "https://example.com/book.epub",
        chapterIndex: 0,
      },
      resolveOffsetToCfi,
    );

    expect(result).toMatchObject({ cfiRange: "whitespace-cfi", matchQuality: "exact" });
    expect(resolveOffsetToCfi).toHaveBeenCalledWith(
      expect.objectContaining({
        startOffset: 7,
        endOffset: 28,
        expectedText: "first\t\t\tsecond\n\nthird",
      }),
    );
  });

  it("fails closed when quote-only CFI resolution returns null", async () => {
    const resolveOffsetToCfi = vi.fn().mockResolvedValue(null);
    const result = await resolveCreateHighlightAnchor(
      {
        chapters: [chapter(0, "Before passage after")],
        text: "passage",
        textAnchor,
        fileBlobUrl: "https://example.com/book.epub",
        chapterIndex: 0,
      },
      resolveOffsetToCfi,
    );

    expect(result).toEqual({
      cfiRange: null,
      matchQuality: "fuzzy",
      chapterIndex: 0,
      textAnchor,
    });
  });
});
