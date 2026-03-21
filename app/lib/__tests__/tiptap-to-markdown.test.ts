import { describe, it, expect } from "vitest";
import { tiptapJsonToMarkdown } from "../tiptap-to-markdown";
import type { JSONContent } from "@tiptap/react";

function doc(...content: JSONContent[]): JSONContent {
  return { type: "doc", content };
}

function p(...children: JSONContent[]): JSONContent {
  return { type: "paragraph", content: children };
}

function text(t: string, marks?: JSONContent["marks"]): JSONContent {
  return { type: "text", text: t, marks };
}

describe("tiptapJsonToMarkdown", () => {
  describe("edge cases", () => {
    it("returns empty string for doc with no content", () => {
      expect(tiptapJsonToMarkdown({ type: "doc" })).toBe("");
    });

    it("returns empty string for doc with empty content array", () => {
      expect(tiptapJsonToMarkdown({ type: "doc", content: [] })).toBe("");
    });

    it("handles paragraph with no content", () => {
      expect(tiptapJsonToMarkdown(doc(p()))).toBe("");
    });
  });

  describe("headings", () => {
    it.each([1, 2, 3, 4, 5, 6])("renders h%i", (level) => {
      const node = doc({ type: "heading", attrs: { level }, content: [text("Title")] });
      expect(tiptapJsonToMarkdown(node)).toBe(`${"#".repeat(level)} Title`);
    });

    it("defaults to h1 when level is missing", () => {
      const node = doc({ type: "heading", content: [text("Title")] });
      expect(tiptapJsonToMarkdown(node)).toBe("# Title");
    });
  });

  describe("paragraph", () => {
    it("renders plain text", () => {
      expect(tiptapJsonToMarkdown(doc(p(text("Hello world"))))).toBe("Hello world");
    });

    it("joins multiple paragraphs with double newline", () => {
      const result = tiptapJsonToMarkdown(doc(p(text("A")), p(text("B"))));
      expect(result).toBe("A\n\nB");
    });
  });

  describe("marks", () => {
    it("renders bold", () => {
      expect(tiptapJsonToMarkdown(doc(p(text("bold", [{ type: "bold" }]))))).toBe("**bold**");
    });

    it("renders italic", () => {
      expect(tiptapJsonToMarkdown(doc(p(text("em", [{ type: "italic" }]))))).toBe("*em*");
    });

    it("renders code", () => {
      expect(tiptapJsonToMarkdown(doc(p(text("code", [{ type: "code" }]))))).toBe("`code`");
    });

    it("renders strike", () => {
      expect(tiptapJsonToMarkdown(doc(p(text("del", [{ type: "strike" }]))))).toBe("~~del~~");
    });

    it("renders link", () => {
      const result = tiptapJsonToMarkdown(
        doc(p(text("click", [{ type: "link", attrs: { href: "https://example.com" } }]))),
      );
      expect(result).toBe("[click](https://example.com)");
    });

    it("renders link with missing href", () => {
      const result = tiptapJsonToMarkdown(doc(p(text("click", [{ type: "link" }]))));
      expect(result).toBe("[click]()");
    });

    it("renders combined bold+italic", () => {
      const result = tiptapJsonToMarkdown(
        doc(p(text("both", [{ type: "bold" }, { type: "italic" }]))),
      );
      expect(result).toBe("***both***");
    });

    it("renders text with no marks unchanged", () => {
      expect(tiptapJsonToMarkdown(doc(p(text("plain"))))).toBe("plain");
    });
  });

  describe("bulletList", () => {
    it("renders simple bullet list", () => {
      const node = doc({
        type: "bulletList",
        content: [
          { type: "listItem", content: [p(text("A"))] },
          { type: "listItem", content: [p(text("B"))] },
        ],
      });
      expect(tiptapJsonToMarkdown(node)).toBe("- A\n- B");
    });

    it("handles empty bulletList", () => {
      expect(tiptapJsonToMarkdown(doc({ type: "bulletList" }))).toBe("");
    });
  });

  describe("orderedList", () => {
    it("renders numbered list", () => {
      const node = doc({
        type: "orderedList",
        content: [
          { type: "listItem", content: [p(text("First"))] },
          { type: "listItem", content: [p(text("Second"))] },
        ],
      });
      expect(tiptapJsonToMarkdown(node)).toBe("1. First\n2. Second");
    });
  });

  describe("nested lists", () => {
    it("renders nested bullet list", () => {
      const node = doc({
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              p(text("Parent")),
              {
                type: "bulletList",
                content: [{ type: "listItem", content: [p(text("Child"))] }],
              },
            ],
          },
        ],
      });
      expect(tiptapJsonToMarkdown(node)).toBe("- Parent\n  - Child");
    });
  });

  describe("blockquote", () => {
    it("renders blockquote", () => {
      const node = doc({ type: "blockquote", content: [p(text("quoted"))] });
      expect(tiptapJsonToMarkdown(node)).toBe("> quoted");
    });
  });

  describe("codeBlock", () => {
    it("renders code block with language", () => {
      const node = doc({
        type: "codeBlock",
        attrs: { language: "ts" },
        content: [text("const x = 1;")],
      });
      expect(tiptapJsonToMarkdown(node)).toBe("```ts\nconst x = 1;\n```");
    });

    it("renders code block without language", () => {
      const node = doc({ type: "codeBlock", content: [text("hello")] });
      expect(tiptapJsonToMarkdown(node)).toBe("```\nhello\n```");
    });
  });

  describe("horizontalRule", () => {
    it("renders horizontal rule", () => {
      expect(tiptapJsonToMarkdown(doc({ type: "horizontalRule" }))).toBe("---");
    });
  });

  describe("highlightReference", () => {
    it("renders highlight reference", () => {
      const node = doc({ type: "highlightReference", attrs: { text: "important" } });
      expect(tiptapJsonToMarkdown(node)).toBe('> "important"');
    });

    it("handles missing text attr", () => {
      const node = doc({ type: "highlightReference" });
      expect(tiptapJsonToMarkdown(node)).toBe('> ""');
    });
  });

  describe("hardBreak", () => {
    it("renders hard break as newline", () => {
      const result = tiptapJsonToMarkdown(
        doc(p(text("line1"), { type: "hardBreak" }, text("line2"))),
      );
      expect(result).toBe("line1\nline2");
    });
  });
});
