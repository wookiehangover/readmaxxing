import { describe, expect, it, vi } from "vitest";
import { createStore } from "idb-keyval";
import { makeAnnotationService, type Highlight } from "~/lib/stores/annotations-store";

const entriesMock = vi.hoisted(() => vi.fn());

vi.mock("idb-keyval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("idb-keyval")>();
  return {
    ...actual,
    entries: entriesMock,
  };
});

function makeHighlight(overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: overrides.id ?? "hl-valid",
    bookId: overrides.bookId ?? "book-1",
    cfiRange: overrides.cfiRange ?? "epubcfi(/6/4!/4/2)",
    text: overrides.text ?? "highlighted text",
    color: overrides.color ?? "#ffff00",
    createdAt: overrides.createdAt ?? 1,
    deletedAt: overrides.deletedAt,
  };
}

describe("AnnotationService entry guards", () => {
  it("getHighlightsByBook skips malformed IDB entries instead of throwing", async () => {
    const validHighlight = makeHighlight();
    entriesMock.mockResolvedValueOnce([
      undefined,
      ["string-value", "not-a-highlight"],
      ["invalid-object", { id: "missing-required-fields" }],
      ["deleted", makeHighlight({ id: "deleted", deletedAt: 2 })],
      ["other-book", makeHighlight({ id: "other-book", bookId: "book-2" })],
      ["valid", validHighlight],
    ]);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const service = makeAnnotationService({
      highlightStore: createStore("annotation-entry-guards-highlights", "highlights"),
      notebookStore: createStore("annotation-entry-guards-notebooks", "notebooks"),
    });

    try {
      const highlights = await service.getHighlightsByBook("book-1");

      expect(highlights).toEqual([validHighlight]);
      expect(warnSpy).toHaveBeenCalledOnce();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
