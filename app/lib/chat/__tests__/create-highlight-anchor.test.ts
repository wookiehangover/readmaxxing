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

  it("falls back to fuzzy without resolving a CFI when the slice does not match", async () => {
    const resolveOffsetToCfi = vi.fn();
    const result = await resolveCreateHighlightAnchor(
      {
        chapters: [chapter(0, "wrong fuzzy chapter"), chapter(3, "Before passage after")],
        text: "passage",
        textAnchor,
        fileBlobUrl: "https://example.com/book.epub",
        chapterIndex: 3,
        startOffset: 0,
        endOffset: 6,
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

  it("reports a non-matching one-character offset as fuzzy", async () => {
    const resolveOffsetToCfi = vi.fn();
    const result = await resolveCreateHighlightAnchor(
      {
        chapters: [chapter(0, "Before passage after")],
        text: "passage",
        textAnchor,
        fileBlobUrl: "https://example.com/book.epub",
        chapterIndex: 0,
        startOffset: 0,
        endOffset: 1,
      },
      resolveOffsetToCfi,
    );

    expect(result.matchQuality).toBe("fuzzy");
    expect(result.cfiRange).toBeNull();
    expect(resolveOffsetToCfi).not.toHaveBeenCalled();
  });
});
