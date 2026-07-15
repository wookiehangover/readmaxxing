import { describe, expect, it } from "vitest";

import type { HighlightRow } from "~/lib/database/annotation/highlight";
import { getNotebookHighlightIds, listLiveHighlightsForBook } from "../highlight-tools";

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
