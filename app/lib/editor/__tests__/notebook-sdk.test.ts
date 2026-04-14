import { describe, it, expect, afterEach } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { createNotebookSDK } from "../notebook-sdk";

function doc(...content: JSONContent[]): JSONContent {
  return { type: "doc", content };
}

function p(text: string): JSONContent {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function heading(level: number, text: string): JSONContent {
  return {
    type: "heading",
    attrs: { level },
    content: [{ type: "text", text }],
  };
}

function bulletList(...items: string[]): JSONContent {
  return {
    type: "bulletList",
    content: items.map((item) => ({
      type: "listItem",
      content: [p(item)],
    })),
  };
}

let destroyFn: (() => void) | null = null;

afterEach(() => {
  destroyFn?.();
  destroyFn = null;
});

function setup(content: JSONContent) {
  const result = createNotebookSDK(content);
  destroyFn = result.destroy;
  return result;
}

describe("createNotebookSDK", () => {
  describe("getBlocks", () => {
    it("returns blocks with correct types and text", () => {
      const { sdk } = setup(doc(heading(1, "Title"), p("Hello world")));
      const blocks = sdk.getBlocks();
      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toMatchObject({ type: "heading", text: "Title", level: 1, index: 0 });
      expect(blocks[1]).toMatchObject({ type: "paragraph", text: "Hello world", index: 1 });
    });

    it("handles empty doc", () => {
      const { sdk } = setup({ type: "doc", content: [] });
      expect(sdk.getBlocks()).toHaveLength(0);
    });
  });

  describe("find", () => {
    it("finds by string query", () => {
      const { sdk } = setup(doc(p("foo bar"), p("baz"), p("foo baz")));
      const results = sdk.find("foo");
      expect(results).toHaveLength(2);
      expect(results[0].text).toBe("foo bar");
      expect(results[1].text).toBe("foo baz");
    });

    it("finds by type filter", () => {
      const { sdk } = setup(doc(heading(1, "Title"), p("text"), heading(2, "Sub")));
      const results = sdk.find({ type: "heading" });
      expect(results).toHaveLength(2);
    });

    it("finds by regex", () => {
      const { sdk } = setup(doc(p("Hello 123"), p("World"), p("Test 456")));
      const results = sdk.find({ text: /\d+/ });
      expect(results).toHaveLength(2);
    });

    it("finds by type and text combined", () => {
      const { sdk } = setup(doc(heading(1, "Intro"), p("Intro text"), heading(2, "Details")));
      const results = sdk.find({ type: "heading", text: "Intro" });
      expect(results).toHaveLength(1);
      expect(results[0].text).toBe("Intro");
    });
  });

  describe("append", () => {
    it("appends markdown to the end", () => {
      const { sdk } = setup(doc(p("First")));
      sdk.append("## New Section\n\nNew content");
      const blocks = sdk.getBlocks();
      expect(blocks.length).toBeGreaterThanOrEqual(3);
      expect(blocks[blocks.length - 1].text).toBe("New content");
    });
  });

  describe("prepend", () => {
    it("prepends markdown to the beginning", () => {
      const { sdk } = setup(doc(p("Existing")));
      sdk.prepend("# Title");
      const blocks = sdk.getBlocks();
      expect(blocks[0]).toMatchObject({ type: "heading", text: "Title" });
    });
  });

  describe("replace", () => {
    it("replaces a block with new markdown", () => {
      const { sdk } = setup(doc(p("Keep"), p("Replace me"), p("Also keep")));
      const target = sdk.find("Replace me")[0];
      sdk.replace(target, "**Replaced**");
      const blocks = sdk.getBlocks();
      const texts = blocks.map((b) => b.text);
      expect(texts).toContain("Replaced");
      expect(texts).not.toContain("Replace me");
      expect(texts).toContain("Keep");
      expect(texts).toContain("Also keep");
    });
  });

  describe("remove", () => {
    it("removes a block", () => {
      const { sdk } = setup(doc(p("Keep"), p("Remove me"), p("Also keep")));
      const target = sdk.find("Remove me")[0];
      sdk.remove(target);
      const texts = sdk.getBlocks().map((b) => b.text);
      expect(texts).not.toContain("Remove me");
      expect(texts).toContain("Keep");
      expect(texts).toContain("Also keep");
    });
  });

  describe("insertAfter", () => {
    it("inserts after a specific block", () => {
      const { sdk } = setup(doc(p("First"), p("Second")));
      const target = sdk.find("First")[0];
      sdk.insertAfter(target, "Inserted");
      const texts = sdk.getBlocks().map((b) => b.text);
      expect(texts.indexOf("Inserted")).toBe(texts.indexOf("First") + 1);
    });
  });

  describe("insertBefore", () => {
    it("inserts before a specific block", () => {
      const { sdk } = setup(doc(p("First"), p("Second")));
      const target = sdk.find("Second")[0];
      sdk.insertBefore(target, "Inserted");
      const texts = sdk.getBlocks().map((b) => b.text);
      expect(texts.indexOf("Inserted")).toBe(texts.indexOf("Second") - 1);
    });
  });

  describe("setContent", () => {
    it("replaces all content", () => {
      const { sdk } = setup(doc(p("Old content")));
      sdk.setContent("# Fresh Start\n\nBrand new");
      const blocks = sdk.getBlocks();
      expect(blocks[0]).toMatchObject({ type: "heading", text: "Fresh Start" });
      expect(blocks.some((b) => b.text === "Old content")).toBe(false);
    });

    it("correctly parses markdown with lists", () => {
      const { sdk } = setup(doc(p("Old")));
      sdk.setContent("- alpha\n- beta\n- gamma");
      const blocks = sdk.getBlocks();
      expect(blocks.some((b) => b.type === "bulletList")).toBe(true);
      const list = blocks.find((b) => b.type === "bulletList")!;
      expect(list.text).toContain("alpha");
      expect(list.text).toContain("beta");
    });
  });

  describe("list editing", () => {
    it("find matches a list item without false positives from concatenated text", () => {
      const { sdk } = setup(doc(bulletList("one", "two", "three")));
      const results = sdk.find("one");
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("bulletList");
      // Should NOT match on concatenated "onetwothree"
      const noMatch = sdk.find("onetwothree");
      expect(noMatch).toHaveLength(0);
    });

    it("getTextFromNode separates list items with newlines", () => {
      const { sdk } = setup(doc(bulletList("alpha", "beta", "gamma")));
      const blocks = sdk.getBlocks();
      const list = blocks.find((b) => b.type === "bulletList")!;
      expect(list.text).toBe("alpha\nbeta\ngamma");
    });

    it("replace on a list block works", () => {
      const { sdk } = setup(doc(p("Before"), bulletList("old1", "old2"), p("After")));
      const list = sdk.find({ type: "bulletList" })[0];
      sdk.replace(list, "- new1\n- new2\n- new3");
      const blocks = sdk.getBlocks();
      const texts = blocks.map((b) => b.text);
      expect(texts).toContain("Before");
      expect(texts).toContain("After");
      const newList = blocks.find((b) => b.type === "bulletList");
      expect(newList).toBeDefined();
      expect(newList!.text).toContain("new1");
      expect(newList!.text).toContain("new2");
      expect(newList!.text).toContain("new3");
      expect(newList!.text).not.toContain("old1");
    });

    it("replace on a paragraph still works after list fix", () => {
      const { sdk } = setup(doc(p("Keep"), p("Replace me"), p("Also keep")));
      const target = sdk.find("Replace me")[0];
      sdk.replace(target, "**Replaced**");
      const blocks = sdk.getBlocks();
      const texts = blocks.map((b) => b.text);
      expect(texts).toContain("Replaced");
      expect(texts).not.toContain("Replace me");
      expect(texts).toContain("Keep");
      expect(texts).toContain("Also keep");
    });
  });

  describe("round-trip", () => {
    it("produces valid JSONContent after mutations", () => {
      const { sdk, getResult } = setup(doc(p("Hello")));
      sdk.append("## Section\n\nContent here");
      sdk.prepend("# Title");
      const result = getResult();
      expect(result.type).toBe("doc");
      expect(result.content).toBeDefined();
      expect(result.content!.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("getMarkdown", () => {
    it("returns markdown representation", () => {
      const { sdk } = setup(doc(heading(1, "Title"), p("Some text")));
      const md = sdk.getMarkdown();
      expect(md).toContain("# Title");
      expect(md).toContain("Some text");
    });
  });
});
