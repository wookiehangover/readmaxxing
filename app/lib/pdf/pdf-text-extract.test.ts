import { describe, expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { extractPdfPageContextFromDoc } from "./pdf-text-extract";

function documentFixture(texts: string[], failedPage?: number) {
  const getPage = vi.fn(async (page: number) => {
    if (page === failedPage) throw new Error("Unavailable page");
    return {
      getTextContent: async () => ({ items: [{ str: texts[page - 1] }] }),
      cleanup: vi.fn(),
    };
  });
  return { numPages: texts.length, getPage } as unknown as PDFDocumentProxy;
}

describe("PDF adjacent page extraction", () => {
  it("reads only the immediate neighbors", async () => {
    const doc = documentFixture(["Old", "Before", "Current", "After", "Later"]);
    await expect(extractPdfPageContextFromDoc(doc, 3)).resolves.toEqual({
      text: "Current",
      previousPage: "Before",
      nextPage: "After",
    });
    expect(vi.mocked(doc.getPage).mock.calls.map(([page]) => page)).toEqual([3, 2, 4]);
  });

  it("handles book edges and unavailable neighbors without dropping the current page", async () => {
    await expect(extractPdfPageContextFromDoc(documentFixture(["Only"]), 1)).resolves.toEqual({
      text: "Only",
      previousPage: null,
      nextPage: null,
    });
    await expect(
      extractPdfPageContextFromDoc(documentFixture(["Before", "Current", "After"], 3), 2),
    ).resolves.toEqual({
      text: "Current",
      previousPage: "Before",
      nextPage: null,
    });
  });
});
