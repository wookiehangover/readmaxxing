import { type JSONContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

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
