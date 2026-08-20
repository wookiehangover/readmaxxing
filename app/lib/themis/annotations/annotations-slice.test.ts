import { getItem } from "@augmentcode/themis/utils/collections/collection-utils";
import { describe, expect, it } from "vitest";

import type { Highlight, Notebook } from "~/lib/stores/annotations-store";
import {
  annotationsHydrateFailed,
  annotationsHydrated,
  annotationsReducer,
  highlightAdded,
  highlightDeleted,
  highlightUpdated,
  hydrateAnnotationsRequested,
  notebookSaved,
} from "~/lib/themis/annotations/annotations-slice";

function makeHighlight(id: string, bookId = "book-1"): Highlight {
  return {
    id,
    bookId,
    cfiRange: `epubcfi(${id})`,
    text: `Highlight ${id}`,
    color: "yellow",
    createdAt: 1,
  };
}

function makeNotebook(bookId = "book-1"): Notebook {
  return { bookId, content: { type: "doc", content: [] }, updatedAt: 2 };
}

describe("annotationsReducer", () => {
  it("hydrates one book without replacing another book's annotations", () => {
    const first = annotationsReducer(
      undefined,
      annotationsHydrated("book-2", [makeHighlight("other", "book-2")], makeNotebook("book-2")),
    );
    const loading = annotationsReducer(first, hydrateAnnotationsRequested("book-1"));
    const hydrated = annotationsReducer(
      loading,
      annotationsHydrated("book-1", [makeHighlight("one")], makeNotebook()),
    );

    expect(getItem(hydrated.highlights, "other")?.bookId).toBe("book-2");
    expect(getItem(hydrated.highlights, "one")?.bookId).toBe("book-1");
    expect(getItem(hydrated.notebooks, "book-1")).toEqual(makeNotebook());
    expect(hydrated.loadedBookIds).toEqual(["book-2", "book-1"]);
    expect(hydrated.loadingBookIds).toEqual([]);
    expect(JSON.parse(JSON.stringify(hydrated))).toEqual(hydrated);
  });

  it("adds, updates, and deletes highlights from the canonical collection", () => {
    const added = annotationsReducer(undefined, highlightAdded(makeHighlight("one")));
    const updatedHighlight = { ...makeHighlight("one"), text: "Updated" };
    const updated = annotationsReducer(added, highlightUpdated(updatedHighlight));
    const deleted = annotationsReducer(updated, highlightDeleted("one"));

    expect(getItem(updated.highlights, "one")).toEqual(updatedHighlight);
    expect(getItem(deleted.highlights, "one")).toBeUndefined();
  });

  it("does not mark a failed hydrate as loaded", () => {
    const loading = annotationsReducer(undefined, hydrateAnnotationsRequested("book-1"));
    const failed = annotationsReducer(
      loading,
      annotationsHydrateFailed("book-1", { _tag: "Error", message: "IDB unavailable" }),
    );

    expect(failed.loadingBookIds).toEqual([]);
    expect(failed.loadedBookIds).toEqual([]);
  });

  it("upserts notebook documents and preserves unknown-action identity", () => {
    const saved = annotationsReducer(undefined, notebookSaved(makeNotebook()));
    const updated = annotationsReducer(
      saved,
      notebookSaved({
        ...makeNotebook(),
        content: { type: "doc", content: [{ type: "paragraph" }] },
      }),
    );

    expect(getItem(updated.notebooks, "book-1")?.content.content).toHaveLength(1);
    expect(annotationsReducer(updated, { type: "unknown" })).toBe(updated);
  });
});
