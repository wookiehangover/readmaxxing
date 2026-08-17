import { Effect } from "effect";
import type { JSONContent } from "@tiptap/react";
import { AppRuntime } from "~/lib/effect-runtime";
import { AnnotationService } from "~/lib/stores/annotations-store";
import { tiptapJsonToMarkdown } from "~/lib/editor/tiptap-to-markdown";

export function downloadNotebookMarkdown(content: JSONContent, bookTitle?: string) {
  const markdown = tiptapJsonToMarkdown(content);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = bookTitle ? `${bookTitle}-annotations.md` : "annotations.md";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export async function exportNotebookMarkdown(bookId: string, bookTitle?: string) {
  const notebook = await AppRuntime.runPromise(
    AnnotationService.pipe(Effect.andThen((service) => service.getNotebook(bookId))),
  );
  if (notebook?.content) downloadNotebookMarkdown(notebook.content, bookTitle);
}
