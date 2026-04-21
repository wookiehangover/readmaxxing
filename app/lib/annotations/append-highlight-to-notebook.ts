import { Effect } from "effect";
import type { JSONContent } from "@tiptap/react";
import { AnnotationService } from "~/lib/stores/annotations-store";
import type { DecodeError, NotebookError } from "~/lib/errors";
import type { HighlightReferenceAttrs } from "~/lib/editor/tiptap-highlight-node";

/**
 * Effect program that appends a highlightReference node (and a trailing empty
 * paragraph, mirroring `TiptapEditor.appendHighlightReference`) to the book's
 * notebook document in IndexedDB, creating the document if it does not yet
 * exist. This is the fallback used when the notebook editor is not currently
 * mounted to receive an imperative append — without it, a freshly-created
 * highlight would have no notebook node and therefore no UI for deletion.
 *
 * Callers that need other UI (e.g. `AnnotationsPanel`'s `useEffectQuery`) to
 * observe the write should dispatch `sync:entity-updated` {notebook} after
 * `runPromise` resolves; this helper intentionally stays side-effect-free
 * beyond the IndexedDB write so it can be composed with other effects.
 */
export function appendHighlightReferenceToNotebook(
  bookId: string,
  attrs: HighlightReferenceAttrs,
): Effect.Effect<void, NotebookError | DecodeError, AnnotationService> {
  return Effect.gen(function* () {
    const svc = yield* AnnotationService;
    const notebook = yield* svc.getNotebook(bookId);
    const existingContent: JSONContent[] = Array.isArray(notebook?.content?.content)
      ? (notebook!.content!.content as JSONContent[])
      : [];
    const highlightNode: JSONContent = { type: "highlightReference", attrs };
    const trailingParagraph: JSONContent = { type: "paragraph" };
    const updatedContent: JSONContent = {
      type: "doc",
      content: [...existingContent, highlightNode, trailingParagraph],
    };
    yield* svc.saveNotebook({
      bookId,
      content: updatedContent,
      updatedAt: Date.now(),
    });
  });
}
