import { describe, expect, it } from "vitest";

import type { HighlightRow } from "~/lib/database/annotation/highlight";
import {
  appendHighlightReferenceToContent,
  getNotebookHighlightIds,
  listLiveHighlightsForBook,
  normalizeCfiRange,
} from "../highlight-tools";

function highlight(overrides: Partial<HighlightRow> & { id: string }): HighlightRow {
  const now = new Date(0);
  return {
    userId: "user-1",
    bookId: "book-1",
    cfiRange: null,
    text: "passage",
    color: null,
    pageNumber: null,
    textOffset: null,
    textLength: null,
    textAnchor: { chapterIndex: 2, snippet: "passage" },
    note: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
    id: overrides.id,
  };
}

describe("highlight tool helpers", () => {
  it("appends an existing highlight reference and trailing paragraph", () => {
    const existingParagraph = {
      type: "paragraph",
      content: [{ type: "text", text: "Existing note" }],
    };

    expect(
      appendHighlightReferenceToContent(
        { type: "doc", content: [existingParagraph] },
        highlight({ id: "orphan", cfiRange: "epubcfi(/6/4)", text: "Quoted passage" }),
      ),
    ).toEqual({
      type: "doc",
      content: [
        existingParagraph,
        {
          type: "highlightReference",
          attrs: {
            highlightId: "orphan",
            cfiRange: "epubcfi(/6/4)",
            text: "Quoted passage",
          },
        },
        { type: "paragraph" },
      ],
    });
  });

  it("refuses to append references without a navigable CFI", () => {
    expect(appendHighlightReferenceToContent(null, highlight({ id: "missing-cfi" }))).toBeNull();
    expect(
      appendHighlightReferenceToContent(null, highlight({ id: "blank-cfi", cfiRange: "   " })),
    ).toBeNull();
    expect(normalizeCfiRange("  epubcfi(/6/4)  ")).toBe("epubcfi(/6/4)");
  });

  it("signals an already-present highlight without changing or duplicating its reference", () => {
    const notebook = {
      type: "doc",
      content: [
        {
          type: "highlightReference",
          attrs: { highlightId: "existing", cfiRange: "epubcfi(/6/4)", text: "passage" },
        },
        { type: "paragraph" },
      ],
    };
    const originalContent = structuredClone(notebook);

    const alreadyPresent = getNotebookHighlightIds(notebook).has("existing");

    expect(alreadyPresent).toBe(true);
    expect(notebook).toEqual(originalContent);
    expect(
      notebook.content.filter(
        (node) => node.type === "highlightReference" && node.attrs?.highlightId === "existing",
      ),
    ).toHaveLength(1);
  });

  it("marks notebook references by highlightId and leaves orphan highlights unmarked", () => {
    const notebook = {
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            {
              type: "highlightReference",
              attrs: { highlightId: "in-notebook", text: "passage" },
            },
          ],
        },
      ],
    };
    const ids = getNotebookHighlightIds(notebook);

    expect(
      listLiveHighlightsForBook(
        [
          highlight({ id: "in-notebook" }),
          highlight({ id: "orphan", textAnchor: { chapterIndex: 4, snippet: "other" } }),
          highlight({ id: "deleted", deletedAt: new Date(1) }),
          highlight({ id: "other-book", bookId: "book-2" }),
        ],
        "book-1",
        ids,
      ),
    ).toEqual([
      {
        id: "in-notebook",
        text: "passage",
        note: null,
        chapterIndex: 2,
        inNotebook: true,
      },
      { id: "orphan", text: "passage", note: null, chapterIndex: 4, inNotebook: false },
    ]);
  });
});
