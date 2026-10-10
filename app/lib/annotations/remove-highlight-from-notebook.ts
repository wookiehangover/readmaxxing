import type { JSONContent } from "@tiptap/react";
import { AnnotationService, type Notebook } from "~/lib/stores/annotations-store";

function withoutHighlightReference(node: JSONContent, highlightId: string): JSONContent {
  if (!node.content) return node;
  return {
    ...node,
    content: node.content
      .filter(
        (child) =>
          !(child.type === "highlightReference" && child.attrs?.highlightId === highlightId),
      )
      .map((child) => withoutHighlightReference(child, highlightId)),
  };
}

/**
 * Removes every highlightReference node for `highlightId` from the book's
 * persisted notebook. Returns the saved notebook, or null when nothing changed.
 */
export async function removeHighlightReferenceFromNotebook(
  bookId: string,
  highlightId: string,
): Promise<Notebook | null> {
  const notebook = await AnnotationService.getNotebook(bookId);
  if (!notebook?.content) return null;
  const content = withoutHighlightReference(notebook.content, highlightId);
  if (JSON.stringify(content) === JSON.stringify(notebook.content)) return null;
  return AnnotationService.saveNotebook({ bookId, content, updatedAt: Date.now() });
}
