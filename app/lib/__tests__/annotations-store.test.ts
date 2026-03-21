import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { createStore, set, get, del, entries } from "idb-keyval";
import { AnnotationService } from "~/lib/annotations-store";
import type { Highlight, Notebook } from "~/lib/annotations-store";
import { HighlightError, NotebookError } from "~/lib/errors";

function makeHighlight(overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: overrides.id ?? "hl-1",
    bookId: overrides.bookId ?? "book-1",
    cfiRange: overrides.cfiRange ?? "epubcfi(/6/4!/4/2)",
    text: overrides.text ?? "highlighted text",
    color: overrides.color ?? "#ffff00",
    createdAt: overrides.createdAt ?? Date.now(),
  };
}

function makeNotebook(overrides: Partial<Notebook> = {}): Notebook {
  return {
    bookId: overrides.bookId ?? "book-1",
    content: overrides.content ?? { type: "doc", content: [] },
    updatedAt: overrides.updatedAt ?? Date.now(),
  };
}

let testCounter = 0;

function makeTestLayer() {
  const suffix = `ann-test-${++testCounter}-${Date.now()}`;
  const hlStore = createStore(`hl-db-${suffix}`, "highlights");
  const nbStore = createStore(`nb-db-${suffix}`, "notebooks");

  return Layer.succeed(AnnotationService, {
    saveHighlight: (highlight) =>
      Effect.tryPromise({
        try: () => set(highlight.id, highlight, hlStore),
        catch: (cause) =>
          new HighlightError({ operation: "saveHighlight", highlightId: highlight.id, cause }),
      }),
    getHighlightsByBook: (bookId) =>
      Effect.tryPromise({
        try: async () => {
          const allEntries = await entries<string, Highlight>(hlStore);
          return allEntries.map(([, hl]) => hl).filter((hl) => hl && hl.bookId === bookId);
        },
        catch: (cause) => new HighlightError({ operation: "getHighlightsByBook", cause }),
      }),
    updateHighlight: (id, updates) =>
      Effect.gen(function* () {
        const existing = yield* Effect.tryPromise({
          try: () => get<Highlight>(id, hlStore),
          catch: (cause) =>
            new HighlightError({ operation: "updateHighlight", highlightId: id, cause }),
        });
        if (!existing) {
          return yield* Effect.fail(
            new HighlightError({ operation: "updateHighlight", highlightId: id }),
          );
        }
        yield* Effect.tryPromise({
          try: () => set(id, { ...existing, ...updates }, hlStore),
          catch: (cause) =>
            new HighlightError({ operation: "updateHighlight", highlightId: id, cause }),
        });
      }),
    deleteHighlight: (id) =>
      Effect.tryPromise({
        try: () => del(id, hlStore),
        catch: (cause) =>
          new HighlightError({ operation: "deleteHighlight", highlightId: id, cause }),
      }),
    saveNotebook: (notebook) =>
      Effect.tryPromise({
        try: () => set(notebook.bookId, notebook, nbStore),
        catch: (cause) =>
          new NotebookError({ operation: "saveNotebook", bookId: notebook.bookId, cause }),
      }),
    getNotebook: (bookId) =>
      Effect.tryPromise({
        try: async () => {
          const notebook = await get<Notebook>(bookId, nbStore);
          return notebook ?? null;
        },
        catch: (cause) => new NotebookError({ operation: "getNotebook", bookId, cause }),
      }),
  });
}

describe("AnnotationService", () => {
  describe("saveHighlight + getHighlightsByBook", () => {
    it("saves and retrieves highlights for a book", async () => {
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, AnnotationService>) =>
        Effect.runPromise(Effect.provide(e, layer));
      const hl = makeHighlight();
      await run(AnnotationService.pipe(Effect.andThen((s) => s.saveHighlight(hl))));
      const results = await run(
        AnnotationService.pipe(Effect.andThen((s) => s.getHighlightsByBook("book-1"))),
      );
      expect(results).toHaveLength(1);
      expect(results[0].text).toBe("highlighted text");
    });

    it("filters highlights by bookId", async () => {
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, AnnotationService>) =>
        Effect.runPromise(Effect.provide(e, layer));
      await run(
        AnnotationService.pipe(
          Effect.andThen((s) => s.saveHighlight(makeHighlight({ id: "hl-1", bookId: "book-1" }))),
        ),
      );
      await run(
        AnnotationService.pipe(
          Effect.andThen((s) => s.saveHighlight(makeHighlight({ id: "hl-2", bookId: "book-2" }))),
        ),
      );
      const results = await run(
        AnnotationService.pipe(Effect.andThen((s) => s.getHighlightsByBook("book-1"))),
      );
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("hl-1");
    });

    it("returns empty array when no highlights", async () => {
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, AnnotationService>) =>
        Effect.runPromise(Effect.provide(e, layer));
      const results = await run(
        AnnotationService.pipe(Effect.andThen((s) => s.getHighlightsByBook("book-1"))),
      );
      expect(results).toEqual([]);
    });
  });

  describe("updateHighlight", () => {
    it("updates an existing highlight", async () => {
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, AnnotationService>) =>
        Effect.runPromise(Effect.provide(e, layer));
      const hl = makeHighlight();
      await run(AnnotationService.pipe(Effect.andThen((s) => s.saveHighlight(hl))));
      await run(
        AnnotationService.pipe(
          Effect.andThen((s) => s.updateHighlight("hl-1", { color: "#ff0000" })),
        ),
      );
      const results = await run(
        AnnotationService.pipe(Effect.andThen((s) => s.getHighlightsByBook("book-1"))),
      );
      expect(results[0].color).toBe("#ff0000");
      expect(results[0].text).toBe("highlighted text");
    });

    it("fails with HighlightError for nonexistent highlight", async () => {
      const layer = makeTestLayer();
      const exit = await Effect.runPromiseExit(
        Effect.provide(
          AnnotationService.pipe(
            Effect.andThen((s) => s.updateHighlight("nonexistent", { color: "#ff0000" })),
          ),
          layer,
        ),
      );
      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        expect((exit.cause as any).error?._tag).toBe("HighlightError");
      }
    });
  });

  describe("deleteHighlight", () => {
    it("deletes a highlight", async () => {
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, AnnotationService>) =>
        Effect.runPromise(Effect.provide(e, layer));
      await run(AnnotationService.pipe(Effect.andThen((s) => s.saveHighlight(makeHighlight()))));
      await run(AnnotationService.pipe(Effect.andThen((s) => s.deleteHighlight("hl-1"))));
      const results = await run(
        AnnotationService.pipe(Effect.andThen((s) => s.getHighlightsByBook("book-1"))),
      );
      expect(results).toEqual([]);
    });
  });

  describe("saveNotebook + getNotebook", () => {
    it("saves and retrieves a notebook", async () => {
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, AnnotationService>) =>
        Effect.runPromise(Effect.provide(e, layer));
      const nb = makeNotebook();
      await run(AnnotationService.pipe(Effect.andThen((s) => s.saveNotebook(nb))));
      const result = await run(
        AnnotationService.pipe(Effect.andThen((s) => s.getNotebook("book-1"))),
      );
      expect(result).not.toBeNull();
      expect(result!.bookId).toBe("book-1");
    });

    it("returns null for missing notebook", async () => {
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, AnnotationService>) =>
        Effect.runPromise(Effect.provide(e, layer));
      const result = await run(
        AnnotationService.pipe(Effect.andThen((s) => s.getNotebook("no-book"))),
      );
      expect(result).toBeNull();
    });
  });
});
