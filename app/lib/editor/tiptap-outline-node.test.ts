import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { Markdown } from "tiptap-markdown";
import { OutlineIncrement } from "./tiptap-outline-node";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("OutlineIncrement", () => {
  it("parses increment metadata and nested Markdown bullets", () => {
    editor = new Editor({
      extensions: [StarterKit, Markdown, OutlineIncrement],
      content:
        '## One\n\n<div data-outline-increment="" data-locator="chapter.xhtml#page=12" data-page="12">\n\n- First fact.\n- Second fact.\n\n</div>',
    });

    expect(editor.getJSON()).toMatchObject({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 } },
        {
          type: "outlineIncrement",
          attrs: { locator: "chapter.xhtml#page=12", page: "12" },
          content: [
            {
              type: "bulletList",
              content: [{ type: "listItem" }, { type: "listItem" }],
            },
          ],
        },
      ],
    });
  });
});
