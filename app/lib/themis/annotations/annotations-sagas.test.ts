import { afterEach, describe, expect, it, vi } from "vitest";

import type { Highlight, Notebook } from "~/lib/stores/annotations-store";

const mocks = vi.hoisted(() => ({ cacheNotebook: vi.fn(), runPromise: vi.fn() }));

vi.mock("~/lib/stores/annotations-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/stores/annotations-store")>();
  return {
    ...actual,
    AnnotationService: new Proxy(actual.AnnotationService, {
      get: (_target, property) =>
        property === "cacheNotebook" ? mocks.cacheNotebook : mocks.runPromise,
    }),
  };
});
vi.mock("~/lib/annotations/append-highlight-to-notebook", () => ({
  appendHighlightReferenceToNotebook: mocks.runPromise,
}));

import { annotationsSaga } from "~/lib/themis/annotations/annotations-sagas";
import {
  addHighlightRequested,
  appendHighlightToNotebookRequested,
  cacheNotebookRequested,
  deleteHighlightRequested,
  hydrateAnnotationsRequested,
  updateHighlightRequested,
  updateNotebookRequested,
} from "~/lib/themis/annotations/annotations-slice";
import { createAppStore, type AppStore } from "~/lib/themis/store";

const stores: AppStore[] = [];

function makeHighlight(overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: "highlight-1",
    bookId: "book-1",
    cfiRange: "epubcfi(/6/4)",
    text: "Passage",
    color: "yellow",
    createdAt: 1,
    ...overrides,
  };
}

function makeNotebook(): Notebook {
  return { bookId: "book-1", content: { type: "doc", content: [] }, updatedAt: 2 };
}

function startStore() {
  const store = createAppStore();
  stores.push(store);
  store.init();
  store.runSaga(annotationsSaga);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  mocks.cacheNotebook.mockReset();
  mocks.runPromise.mockReset();
  vi.restoreAllMocks();
});

describe("annotationsSaga", () => {
  it("hydrates highlights and a notebook from persistence", async () => {
    const highlight = makeHighlight();
    const notebook = makeNotebook();
    mocks.runPromise.mockResolvedValueOnce([highlight]).mockResolvedValueOnce(notebook);
    const store = startStore();

    store.dispatch(hydrateAnnotationsRequested("book-1"));

    await vi.waitFor(() =>
      expect(
        store.annotationsSelectors.selectHighlightsByBook.select(store.state, "book-1"),
      ).toEqual([highlight]),
    );
    expect(store.annotationsSelectors.selectNotebookByBookId.select(store.state, "book-1")).toEqual(
      notebook,
    );
    expect(mocks.runPromise).toHaveBeenCalledTimes(2);
  });

  it("adds and updates the collection only after persistence succeeds", async () => {
    const original = makeHighlight();
    const updated = makeHighlight({ text: "Updated", updatedAt: 3 });
    const onAdded = vi.fn();
    const onUpdated = vi.fn();
    mocks.runPromise
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([original])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([updated]);
    const store = startStore();

    store.dispatch(addHighlightRequested(original, onAdded));
    await vi.waitFor(() => expect(onAdded).toHaveBeenCalledWith(original));
    store.dispatch(updateHighlightRequested("book-1", original.id, { text: "Updated" }, onUpdated));

    await vi.waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated));
    expect(store.annotationsSelectors.selectHighlightById.select(store.state, original.id)).toEqual(
      updated,
    );
  });

  it("keeps failed writes out of the collection", async () => {
    const onFailed = vi.fn();
    mocks.runPromise.mockRejectedValueOnce(new Error("IDB unavailable"));
    const store = startStore();

    store.dispatch(addHighlightRequested(makeHighlight(), undefined, onFailed));

    await vi.waitFor(() => expect(onFailed).toHaveBeenCalledWith("IDB unavailable"));
    expect(store.annotationsSelectors.selectHighlightsByBook.select(store.state, "book-1")).toEqual(
      [],
    );
  });

  it("deletes a highlight only after persistence succeeds", async () => {
    const highlight = makeHighlight();
    const onCompleted = vi.fn();
    mocks.runPromise
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([highlight])
      .mockResolvedValueOnce(undefined);
    const store = startStore();
    store.dispatch(addHighlightRequested(highlight));
    await vi.waitFor(() =>
      expect(
        store.annotationsSelectors.selectHighlightById.select(store.state, highlight.id),
      ).toEqual(highlight),
    );

    store.dispatch(deleteHighlightRequested("book-1", highlight.id, onCompleted));

    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledOnce());
    expect(
      store.annotationsSelectors.selectHighlightById.select(store.state, highlight.id),
    ).toBeUndefined();
  });

  it("persists immediate notebook updates and highlight appends before collection updates", async () => {
    const notebook = makeNotebook();
    const appended = {
      ...notebook,
      content: { type: "doc", content: [{ type: "highlightReference" }] },
    };
    mocks.runPromise.mockResolvedValueOnce(undefined).mockResolvedValueOnce(appended);
    const store = startStore();

    store.dispatch(updateNotebookRequested("book-1", notebook.content, true));
    await vi.waitFor(() =>
      expect(
        store.annotationsSelectors.selectNotebookByBookId.select(store.state, "book-1"),
      ).toMatchObject({
        bookId: "book-1",
        content: notebook.content,
      }),
    );
    store.dispatch(
      appendHighlightToNotebookRequested("book-1", {
        highlightId: "highlight-1",
        cfiRange: "epubcfi(/6/4)",
        text: "Passage",
      }),
    );

    await vi.waitFor(() =>
      expect(
        store.annotationsSelectors.selectNotebookByBookId.select(store.state, "book-1"),
      ).toEqual(appended),
    );
  });

  it("caches a server-authoritative notebook without using the change-recording save path", async () => {
    const notebook = makeNotebook();
    const onCompleted = vi.fn();
    mocks.cacheNotebook.mockResolvedValueOnce(undefined);
    const store = startStore();

    store.dispatch(cacheNotebookRequested(notebook, onCompleted));

    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledWith(notebook));
    expect(mocks.cacheNotebook).toHaveBeenCalledWith(notebook);
    expect(mocks.runPromise).not.toHaveBeenCalled();
    expect(store.annotationsSelectors.selectNotebookByBookId.select(store.state, "book-1")).toEqual(
      notebook,
    );
  });

  it("keeps a failed server-authoritative notebook cache out of the collection", async () => {
    const notebook = makeNotebook();
    mocks.cacheNotebook.mockRejectedValueOnce(new Error("Cache unavailable"));
    const store = startStore();

    store.dispatch(cacheNotebookRequested(notebook));

    await vi.waitFor(() =>
      expect(store.annotationsSelectors.selectAnnotationsError.select(store.state, "book-1")).toBe(
        "Cache unavailable",
      ),
    );
    expect(
      store.annotationsSelectors.selectNotebookByBookId.select(store.state, "book-1"),
    ).toBeUndefined();
  });
});
