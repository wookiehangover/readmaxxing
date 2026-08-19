import type { JSONContent } from "@tiptap/react";
import { AnnotationService, type Notebook } from "~/lib/stores/annotations-store";
import type { HighlightReferenceAttrs } from "~/lib/editor/tiptap-highlight-node";

/**
 * Appends a highlightReference node (and a trailing empty
 * paragraph, mirroring `TiptapEditor.appendHighlightReference`) to the book's
 * notebook document in IndexedDB, creating the document if it does not yet
 * exist. This is the fallback used when the notebook editor is not currently
 * mounted to receive an imperative append — without it, a freshly-created
 * highlight would have no notebook node and therefore no UI for deletion.
 *
 * The annotations saga uses the returned notebook to update the normalized
 * collection after persistence. Legacy chat callers ignore the return value.
 */
export function appendHighlightReferenceToNotebook(
  bookId: string,
  attrs: HighlightReferenceAttrs,
): Promise<Notebook> {
  return (async () => {
    const notebook = await AnnotationService.getNotebook(bookId);
    const existingContent: JSONContent[] = Array.isArray(notebook?.content?.content)
      ? (notebook!.content!.content as JSONContent[])
      : [];
    const highlightNode: JSONContent = { type: "highlightReference", attrs };
    const trailingParagraph: JSONContent = { type: "paragraph" };
    const updatedContent: JSONContent = {
      type: "doc",
      content: [...existingContent, highlightNode, trailingParagraph],
    };
    const updatedNotebook: Notebook = {
      bookId,
      content: updatedContent,
      updatedAt: Date.now(),
    };
    await AnnotationService.saveNotebook(updatedNotebook);
    return updatedNotebook;
  })();
}
