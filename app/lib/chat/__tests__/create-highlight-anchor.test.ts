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
});
