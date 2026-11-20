import { getSchema, type AnyExtension } from "@tiptap/core";
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import type { JSONContent } from "@tiptap/react";
import { parseHTML } from "linkedom";
import markdownit from "markdown-it";

const md = markdownit({ html: false, linkify: true, breaks: false });
const schema = getSchema([StarterKit as unknown as AnyExtension]);

export function markdownToTiptapJsonServer(markdown: string): JSONContent {
  const html = md.render(markdown);
  const { document } = parseHTML("<!DOCTYPE html><html><body>" + html + "</body></html>");
  const pmDoc = PMDOMParser.fromSchema(schema).parse(document.body);
  return pmDoc.toJSON() as JSONContent;
}
