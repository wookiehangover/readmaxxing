import { type JSONContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

/**
 * Converts a markdown string to tiptap JSONContent using a headless editor
 * with the tiptap-markdown extension. This is the inverse of tiptapJsonToMarkdown.
 *
 * Must be called client-side only (requires DOM).
 */
export function markdownToTiptapJson(markdown: string): JSONContent {
  const editor = new Editor({
    extensions: [
      StarterKit,
      Markdown.configure({
        html: false,
      }),
    ],
    content: markdown,
  });

  const json = editor.getJSON();
  editor.destroy();
  return json;
}
