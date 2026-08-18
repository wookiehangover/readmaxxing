import { describe, expect, it } from "vitest";
import { pdfChapterLabelForPage } from "~/hooks/use-pdf-lifecycle";

describe("pdfChapterLabelForPage", () => {
  const chapters = [
    { label: "Introduction", page: 1 },
    { label: "Part I", page: 12 },
    { label: "Chapter 3", page: 48 },
  ];

  it("uses the nearest PDF bookmark at or before the current page", () => {
    expect(pdfChapterLabelForPage(chapters, 1)).toBe("Introduction");
    expect(pdfChapterLabelForPage(chapters, 47)).toBe("Part I");
    expect(pdfChapterLabelForPage(chapters, 48)).toBe("Chapter 3");
    expect(pdfChapterLabelForPage(chapters, 200)).toBe("Chapter 3");
  });

  it("returns null before the first resolved bookmark", () => {
    expect(pdfChapterLabelForPage([{ label: "Chapter 1", page: 5 }], 2)).toBeNull();
  });
});
