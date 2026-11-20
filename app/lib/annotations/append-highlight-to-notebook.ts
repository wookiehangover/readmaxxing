import type { JSONContent } from "@tiptap/react";
import { AnnotationService, type Notebook } from "~/lib/stores/annotations-store";
import type { HighlightReferenceAttrs } from "~/lib/editor/tiptap-highlight-node";

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
    return AnnotationService.saveNotebook(updatedNotebook);
  })();
}
