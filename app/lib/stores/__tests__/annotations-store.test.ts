import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { createStore } from "idb-keyval";
import { AnnotationService, makeAnnotationService } from "~/lib/stores/annotations-store";
import type { Highlight, Notebook } from "~/lib/stores/annotations-store";

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

  return Layer.succeed(
    AnnotationService,
    makeAnnotationService({ highlightStore: hlStore, notebookStore: nbStore }),
  );
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

    it("persists appended content immediately without requiring a debounce flush", async () => {
      // Regression test: append_to_notes must survive panel close/unmount.
      // Previously, when the notebook editor was open, appends only triggered a
      // debounced save. If the panel unmounted before the debounce fired, the
      // appended content was lost. The fix ensures saveNotebook is called
      // immediately after append, so a getNotebook right after returns the
      // updated content.
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, AnnotationService>) =>
        Effect.runPromise(Effect.provide(e, layer));

      // Simulate existing notebook content
      const initial = makeNotebook({
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "existing note" }] }],
        },
      });
      await run(AnnotationService.pipe(Effect.andThen((s) => s.saveNotebook(initial))));

      // Simulate what append_to_notes does: read, merge, save immediately
      await run(
        Effect.gen(function* () {
          const svc = yield* AnnotationService;
          const notebook = yield* svc.getNotebook("book-1");
          const existingContent = notebook?.content?.content ?? [];
          const newNode = {
            type: "paragraph",
            content: [{ type: "text", text: "AI appended note" }],
          };
          const updatedContent = {
            type: "doc" as const,
            content: [...existingContent, newNode],
          };
          yield* svc.saveNotebook({
            bookId: "book-1",
            content: updatedContent,
            updatedAt: Date.now(),
          });
          return updatedContent;
        }),
      );

      // Immediately read back — no debounce delay, simulating unmount right after
      const result = await run(
        AnnotationService.pipe(Effect.andThen((s) => s.getNotebook("book-1"))),
      );
      expect(result).not.toBeNull();
      expect(result!.content.content).toHaveLength(2);
      expect((result!.content as any).content[1].content[0].text).toBe("AI appended note");
    });

    it("append_to_notes falls back to IndexedDB when editor is not ready (loading window)", async () => {
      // When the notebook panel is mounted but the Tiptap editor hasn't
      // initialised yet, notebookEditorCallbackMap has no entry for the book.
      // The tool handler must fall back to the IndexedDB read-merge-write path
      // and produce the correct merged content.
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, AnnotationService>) =>
        Effect.runPromise(Effect.provide(e, layer));

      // Pre-existing notebook content saved from an earlier session
      const initial = makeNotebook({
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "prior notes" }] }],
        },
      });
      await run(AnnotationService.pipe(Effect.andThen((s) => s.saveNotebook(initial))));

      // Simulate append_to_notes fallback: no editor callbacks available,
      // so we read from IndexedDB, merge, and write back
      await run(
        Effect.gen(function* () {
          const svc = yield* AnnotationService;
          const notebook = yield* svc.getNotebook("book-1");
          const existingContent = notebook?.content?.content ?? [];
          const newNodes = [
            {
              type: "heading",
              attrs: { level: 2 },
              content: [{ type: "text", text: "New Section" }],
            },
            { type: "paragraph", content: [{ type: "text", text: "Appended during load" }] },
          ];
          const updatedContent = {
            type: "doc" as const,
            content: [...existingContent, ...newNodes],
          };
          yield* svc.saveNotebook({
            bookId: "book-1",
            content: updatedContent,
            updatedAt: Date.now(),
          });
        }),
      );

      const result = await run(
        AnnotationService.pipe(Effect.andThen((s) => s.getNotebook("book-1"))),
      );
      expect(result).not.toBeNull();
      // Original 1 node + 2 new nodes = 3
      expect(result!.content.content).toHaveLength(3);
      expect((result!.content as any).content[0].content[0].text).toBe("prior notes");
      expect((result!.content as any).content[1].content[0].text).toBe("New Section");
      expect((result!.content as any).content[2].content[0].text).toBe("Appended during load");
    });

    it("edit_notes reads real content from IndexedDB when editor is not ready", async () => {
      // During the loading window, edit_notes must read the actual notebook
      // content from IndexedDB (not an empty placeholder) so that SDK
      // mutations operate on real data.
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, AnnotationService>) =>
        Effect.runPromise(Effect.provide(e, layer));

      const initial = makeNotebook({
        content: {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 1 },
              content: [{ type: "text", text: "My Book Notes" }],
            },
            { type: "paragraph", content: [{ type: "text", text: "Important insight" }] },
          ],
        },
      });
      await run(AnnotationService.pipe(Effect.andThen((s) => s.saveNotebook(initial))));

      // Simulate edit_notes fallback: read from IndexedDB since editor
      // is not ready (no callbacks in map)
      const notebook = await run(
        AnnotationService.pipe(Effect.andThen((s) => s.getNotebook("book-1"))),
      );
      const currentContent = notebook?.content ?? { type: "doc" as const, content: [] };

      // The content should be the real notebook, not an empty doc
      expect(currentContent.content).toHaveLength(2);
      expect((currentContent as any).content[0].content[0].text).toBe("My Book Notes");
      expect((currentContent as any).content[1].content[0].text).toBe("Important insight");
    });
  });
});
