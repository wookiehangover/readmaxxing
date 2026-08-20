import { createStore, set } from "idb-keyval";
import { describe, expect, it, vi } from "vitest";

import { makeAnnotationService } from "~/lib/stores/annotations-store";
import { makeBookService } from "~/lib/stores/book-store";
import { makeBookmarkService } from "~/lib/stores/bookmark-store";
import {
  serverBookToLocal,
  serverBookmarkToLocal,
  serverHighlightToLocal,
  serverNotebookToLocal,
} from "~/lib/sync/server-transforms";

const SERVER_TIME = "2026-08-20T00:00:00.000Z";
let testCounter = 0;

function store(name: string) {
  const suffix = `${++testCounter}-${Date.now()}`;
  return createStore(`${name}-decoder-${suffix}`, name);
}

describe("server transform and handwritten decoder parity", () => {
  it("accepts transformed books and rejects invalid required book fields", async () => {
    const bookStore = store("books");
    const service = makeBookService({ bookStore, bookDataStore: store("book-data") });
    const transformed = serverBookToLocal({
      id: "book-1",
      title: "Server book",
      author: "Server author",
      format: "epub",
      updatedAt: SERVER_TIME,
    });
    await set("book-1", transformed, bookStore);
    const invalidFields: [string, unknown][] = [
      ["id", undefined],
      ["title", undefined],
      ["author", undefined],
      ["coverImage", undefined],
      ["format", "mobi"],
    ];
    for (const [field, value] of invalidFields) {
      await set(
        `invalid-${field}`,
        { ...transformed, id: `invalid-${field}`, [field]: value },
        bookStore,
      );
    }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(service.getBooks()).resolves.toEqual([transformed]);
    expect(warn).toHaveBeenCalledTimes(invalidFields.length);
    warn.mockRestore();
  });

  it("accepts transformed bookmarks and rejects invalid required bookmark fields", async () => {
    const bookmarkStore = store("bookmarks");
    const service = makeBookmarkService({ bookmarkStore });
    const transformed = serverBookmarkToLocal({
      id: "bookmark-1",
      bookId: "book-1",
      cfi: "epubcfi(/6/4)",
      createdAt: SERVER_TIME,
      updatedAt: SERVER_TIME,
    });
    await set("bookmark-1", transformed, bookmarkStore);
    for (const [field, value] of [
      ["id", undefined],
      ["bookId", undefined],
      ["createdAt", "invalid"],
    ] as [string, unknown][]) {
      await set(
        `invalid-${field}`,
        { ...transformed, id: `invalid-${field}`, [field]: value },
        bookmarkStore,
      );
    }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(service.getBookmarksByBook("book-1")).resolves.toEqual([transformed]);
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it("accepts transformed annotations and rejects invalid required annotation fields", async () => {
    const highlightStore = store("highlights");
    const notebookStore = store("notebooks");
    const service = makeAnnotationService({ highlightStore, notebookStore });
    const highlight = serverHighlightToLocal({
      id: "highlight-1",
      bookId: "book-1",
      cfiRange: "epubcfi(/6/4)",
      text: "Passage",
      color: "yellow",
      createdAt: SERVER_TIME,
      updatedAt: SERVER_TIME,
    });
    await set("highlight-1", highlight, highlightStore);
    for (const [field, value] of [
      ["id", undefined],
      ["bookId", undefined],
      ["cfiRange", undefined],
      ["text", undefined],
      ["color", undefined],
      ["createdAt", "invalid"],
    ] as [string, unknown][]) {
      await set(
        `invalid-${field}`,
        { ...highlight, id: `invalid-${field}`, [field]: value },
        highlightStore,
      );
    }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(service.getHighlightsByBook("book-1")).resolves.toEqual([highlight]);
    expect(warn).toHaveBeenCalledTimes(6);
    warn.mockRestore();

    const notebook = serverNotebookToLocal({
      bookId: "book-1",
      content: { type: "doc", content: [] },
      updatedAt: SERVER_TIME,
    });
    await set("book-1", notebook, notebookStore);
    await expect(service.getNotebook("book-1")).resolves.toEqual(notebook);
    await set("invalid-book", { ...notebook, bookId: undefined }, notebookStore);
    await set("missing-content", { ...notebook, content: undefined }, notebookStore);
    await set("invalid-content", { ...notebook, content: "invalid" }, notebookStore);
    await set("invalid-time", { ...notebook, updatedAt: "invalid" }, notebookStore);
    await expect(service.getNotebook("invalid-book")).rejects.toMatchObject({
      _tag: "DecodeError",
    });
    await expect(service.getNotebook("invalid-time")).rejects.toMatchObject({
      _tag: "DecodeError",
    });
    await expect(service.getNotebook("missing-content")).rejects.toMatchObject({
      _tag: "DecodeError",
    });
    await expect(service.getNotebook("invalid-content")).rejects.toMatchObject({
      _tag: "DecodeError",
    });
  });
});
