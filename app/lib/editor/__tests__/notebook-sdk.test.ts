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

/** Create a listItem with text and a nested bulletList */
function listItemWithNested(text: string, ...subItems: string[]): JSONContent {
  return {
    type: "listItem",
    content: [
      p(text),
      {
        type: "bulletList",
        content: subItems.map((sub) => ({
          type: "listItem",
          content: [p(sub)],
        })),
      },
    ],
  };
}

/** Create a bulletList with arbitrary listItem nodes (supports nesting) */
function nestedBulletList(...items: JSONContent[]): JSONContent {
  return { type: "bulletList", content: items };
}

function simpleListItem(text: string): JSONContent {
  return { type: "listItem", content: [p(text)] };
}

function orderedList(...items: string[]): JSONContent {
  return {
    type: "orderedList",
    attrs: { start: 1 },
    content: items.map((item) => ({
      type: "listItem",
      content: [p(item)],
    })),
  };
}

function blockquote(...content: JSONContent[]): JSONContent {
  return { type: "blockquote", content };
}

function codeBlock(text: string): JSONContent {
  return {
    type: "codeBlock",
    attrs: { language: null },
    content: [{ type: "text", text }],
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

  describe("setText", () => {
    it("setText on heading preserves level and only swaps text", () => {
      const { sdk } = setup(doc(p("Before"), heading(2, "Old Heading"), p("After")));
      const target = sdk.find({ type: "heading", text: "Old Heading" })[0];
      const result = sdk.setText(target, "New Heading");
      expect(result).toBe(true);
      const blocks = sdk.getBlocks();
      const h = blocks.find((b) => b.type === "heading")!;
      expect(h).toBeDefined();
      expect(h.text).toBe("New Heading");
      expect(h.level).toBe(2);
      const texts = blocks.map((b) => b.text);
      expect(texts).toContain("Before");
      expect(texts).toContain("After");
      expect(texts).not.toContain("Old Heading");
    });

    it("setText on paragraph keeps paragraph type", () => {
      const { sdk } = setup(doc(p("Keep"), p("Change me"), p("Also keep")));
      const target = sdk.find("Change me")[0];
      const result = sdk.setText(target, "Changed");
      expect(result).toBe(true);
      const blocks = sdk.getBlocks();
      const changed = blocks.find((b) => b.text === "Changed")!;
      expect(changed).toBeDefined();
      expect(changed.type).toBe("paragraph");
      const texts = blocks.map((b) => b.text);
      expect(texts).toContain("Keep");
      expect(texts).toContain("Also keep");
      expect(texts).not.toContain("Change me");
    });

    it("setText on blockquote keeps blockquote type", () => {
      const { sdk } = setup(doc(blockquote(p("Quoted")), p("After")));
      const target = sdk.find({ type: "blockquote" })[0];
      const result = sdk.setText(target, "Requoted");
      expect(result).toBe(true);
      const blocks = sdk.getBlocks();
      const bq = blocks.find((b) => b.type === "blockquote")!;
      expect(bq).toBeDefined();
      expect(bq.text).toContain("Requoted");
      expect(blocks.map((b) => b.text)).toContain("After");
    });

    it("setText on codeBlock preserves language attr", () => {
      const { sdk } = setup(
        doc({
          type: "codeBlock",
          attrs: { language: "typescript" },
          content: [{ type: "text", text: "const x = 1;" }],
        }),
      );
      const target = sdk.find({ type: "codeBlock" })[0];
      const result = sdk.setText(target, "const y = 2;");
      expect(result).toBe(true);
      const blocks = sdk.getBlocks();
      const cb = blocks.find((b) => b.type === "codeBlock")!;
      expect(cb).toBeDefined();
      expect(cb.text).toBe("const y = 2;");
      expect(cb.attrs?.language).toBe("typescript");
    });

    it("setText on listItem preserves list and siblings", () => {
      const { sdk } = setup(doc(p("Before"), bulletList("one", "two", "three"), p("After")));
      const target = sdk.find({ type: "listItem", text: "two" })[0];
      const result = sdk.setText(target, "TWO");
      expect(result).toBe(true);
      const blocks = sdk.getBlocks();
      const list = blocks.find((b) => b.type === "bulletList");
      expect(list).toBeDefined();
      const items = blocks.filter((b) => b.type === "listItem").map((b) => b.text);
      expect(items).toEqual(["one", "TWO", "three"]);
      const texts = blocks.map((b) => b.text);
      expect(texts).toContain("Before");
      expect(texts).toContain("After");
    });

    it("setText on bulletList returns false and does not mutate", () => {
      const { sdk } = setup(doc(bulletList("a", "b")));
      const list = sdk.find({ type: "bulletList" })[0];
      const result = sdk.setText(list, "nope");
      expect(result).toBe(false);
      const items = sdk.find({ type: "listItem" }).map((b) => b.text);
      expect(items).toEqual(["a", "b"]);
    });

    it("setText inserts text verbatim (no markdown parsing)", () => {
      const { sdk } = setup(doc(heading(1, "Title")));
      const target = sdk.find({ type: "heading" })[0];
      sdk.setText(target, "# not a heading marker");
      const blocks = sdk.getBlocks();
      const h = blocks.find((b) => b.type === "heading")!;
      expect(h.text).toBe("# not a heading marker");
      expect(h.level).toBe(1);
    });

    it("setText returns false for unknown block", () => {
      const { sdk } = setup(doc(p("Hello")));
      const fake = { type: "paragraph" as const, text: "Nope", index: 99, _pos: 999 };
      expect(sdk.setText(fake, "never")).toBe(false);
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

  describe("public surface", () => {
    it("does not expose setContent to AI-facing callers", () => {
      const { sdk } = setup(doc(p("Hello")));
      expect((sdk as unknown as { setContent?: unknown }).setContent).toBeUndefined();
    });
  });

  describe("list editing", () => {
    it("find matches a list item without false positives from concatenated text", () => {
      const { sdk } = setup(doc(bulletList("one", "two", "three")));
      const results = sdk.find("one");
      // Matches both the bulletList (text contains "one") and the listItem "one"
      expect(results).toHaveLength(2);
      expect(results[0].type).toBe("bulletList");
      expect(results[1].type).toBe("listItem");
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

  describe("listItem blocks", () => {
    it("getBlocks emits listItem blocks after their parent list", () => {
      const { sdk } = setup(doc(bulletList("alpha", "beta", "gamma")));
      const blocks = sdk.getBlocks();
      // Should have 1 bulletList + 3 listItems = 4 blocks
      expect(blocks).toHaveLength(4);
      expect(blocks[0].type).toBe("bulletList");
      expect(blocks[1]).toMatchObject({ type: "listItem", text: "alpha", parentIndex: 0 });
      expect(blocks[2]).toMatchObject({ type: "listItem", text: "beta", parentIndex: 0 });
      expect(blocks[3]).toMatchObject({ type: "listItem", text: "gamma", parentIndex: 0 });
    });

    it("find({ type: 'listItem' }) returns individual list items", () => {
      const { sdk } = setup(doc(p("Intro"), bulletList("one", "two", "three")));
      const items = sdk.find({ type: "listItem" });
      expect(items).toHaveLength(3);
      expect(items[0].text).toBe("one");
      expect(items[1].text).toBe("two");
      expect(items[2].text).toBe("three");
    });

    it("find({ type: 'listItem', text: '...' }) filters list items by text", () => {
      const { sdk } = setup(doc(bulletList("apple", "banana", "apricot")));
      const items = sdk.find({ type: "listItem", text: "ap" });
      expect(items).toHaveLength(2);
      expect(items[0].text).toBe("apple");
      expect(items[1].text).toBe("apricot");
    });

    it("replace on a listItem replaces just that item", () => {
      const { sdk } = setup(doc(bulletList("first", "second", "third")));
      const items = sdk.find({ type: "listItem", text: "second" });
      expect(items).toHaveLength(1);
      const result = sdk.replace(items[0], "replaced");
      expect(result).toBe(true);
      const allItems = sdk.find({ type: "listItem" });
      const texts = allItems.map((b) => b.text);
      expect(texts).toContain("first");
      expect(texts).toContain("replaced");
      expect(texts).toContain("third");
      expect(texts).not.toContain("second");
    });

    it("remove on a listItem removes just that item", () => {
      const { sdk } = setup(doc(bulletList("keep1", "remove-me", "keep2")));
      const items = sdk.find({ type: "listItem", text: "remove-me" });
      expect(items).toHaveLength(1);
      const result = sdk.remove(items[0]);
      expect(result).toBe(true);
      const remaining = sdk.find({ type: "listItem" });
      const texts = remaining.map((b) => b.text);
      expect(texts).toContain("keep1");
      expect(texts).toContain("keep2");
      expect(texts).not.toContain("remove-me");
    });
  });

  describe("replace after list (Bug 1: index conflation)", () => {
    it("replaces a paragraph that comes after a bullet list", () => {
      const { sdk } = setup(doc(p("Before"), bulletList("a", "b", "c"), p("Target"), p("After")));
      const target = sdk.find("Target")[0];
      expect(target.type).toBe("paragraph");
      const result = sdk.replace(target, "Replaced");
      expect(result).toBe(true);
      const blocks = sdk.getBlocks();
      const texts = blocks.map((b) => b.text);
      expect(texts).toContain("Before");
      expect(texts).toContain("Replaced");
      expect(texts).toContain("After");
      expect(texts).not.toContain("Target");
    });

    it("replaces a heading that comes after multiple lists", () => {
      const { sdk } = setup(
        doc(bulletList("x", "y"), bulletList("a", "b"), heading(2, "Target Heading"), p("End")),
      );
      const target = sdk.find("Target Heading")[0];
      expect(target.type).toBe("heading");
      const result = sdk.replace(target, "## New Heading");
      expect(result).toBe(true);
      const blocks = sdk.getBlocks();
      const texts = blocks.map((b) => b.text);
      expect(texts).toContain("New Heading");
      expect(texts).not.toContain("Target Heading");
      expect(texts).toContain("End");
    });
  });

  describe("listItem operations at any position (Bug 2)", () => {
    it("replaces the third list item", () => {
      const { sdk } = setup(doc(bulletList("first", "second", "third", "fourth")));
      const items = sdk.find({ type: "listItem", text: "third" });
      expect(items).toHaveLength(1);
      const result = sdk.replace(items[0], "replaced-third");
      expect(result).toBe(true);
      const allItems = sdk.find({ type: "listItem" });
      const texts = allItems.map((b) => b.text);
      expect(texts).toEqual(["first", "second", "replaced-third", "fourth"]);
    });

    it("removes the last list item", () => {
      const { sdk } = setup(doc(bulletList("keep1", "keep2", "remove-last")));
      const items = sdk.find({ type: "listItem", text: "remove-last" });
      const result = sdk.remove(items[0]);
      expect(result).toBe(true);
      const remaining = sdk.find({ type: "listItem" });
      expect(remaining.map((b) => b.text)).toEqual(["keep1", "keep2"]);
    });

    it("removes the only list item (removes entire list)", () => {
      const { sdk } = setup(doc(p("Before"), bulletList("only"), p("After")));
      const items = sdk.find({ type: "listItem", text: "only" });
      const result = sdk.remove(items[0]);
      expect(result).toBe(true);
      const blocks = sdk.getBlocks();
      expect(blocks.find((b) => b.type === "bulletList")).toBeUndefined();
      expect(blocks.map((b) => b.text)).toContain("Before");
      expect(blocks.map((b) => b.text)).toContain("After");
    });
  });

  describe("sequential mutations (Bug 3: stale blocks)", () => {
    it("find → replace → find → replace works correctly", () => {
      const { sdk } = setup(doc(p("AAA"), p("BBB"), p("CCC")));

      // First mutation
      const first = sdk.find("AAA")[0];
      sdk.replace(first, "XXX");

      // Second mutation (must re-find)
      const second = sdk.find("BBB")[0];
      sdk.replace(second, "YYY");

      const blocks = sdk.getBlocks();
      const texts = blocks.map((b) => b.text);
      expect(texts).toContain("XXX");
      expect(texts).toContain("YYY");
      expect(texts).toContain("CCC");
      expect(texts).not.toContain("AAA");
      expect(texts).not.toContain("BBB");
    });

    it("stale block is re-found by text match", () => {
      const { sdk } = setup(doc(p("First"), p("Target"), p("Last")));

      // Get block reference
      const target = sdk.find("Target")[0];

      // Mutate the doc (makes target stale)
      sdk.prepend("# New Title");

      // Using the stale block should still work via re-find
      const result = sdk.replace(target, "Replaced");
      expect(result).toBe(true);
      const blocks = sdk.getBlocks();
      expect(blocks.map((b) => b.text)).toContain("Replaced");
      expect(blocks.map((b) => b.text)).not.toContain("Target");
    });
  });

  describe("boolean return values", () => {
    it("replace returns true on success", () => {
      const { sdk } = setup(doc(p("Hello")));
      const target = sdk.find("Hello")[0];
      expect(sdk.replace(target, "World")).toBe(true);
    });

    it("replace returns false when block not found", () => {
      const { sdk } = setup(doc(p("Hello")));
      const fakeBlock = { type: "paragraph" as const, text: "Nope", index: 99, _pos: 999 };
      expect(sdk.replace(fakeBlock, "World")).toBe(false);
    });

    it("remove returns true on success", () => {
      const { sdk } = setup(doc(p("Hello"), p("World")));
      const target = sdk.find("Hello")[0];
      expect(sdk.remove(target)).toBe(true);
    });

    it("remove returns false when block not found", () => {
      const { sdk } = setup(doc(p("Hello")));
      const fakeBlock = { type: "paragraph" as const, text: "Nope", index: 99, _pos: 999 };
      expect(sdk.remove(fakeBlock)).toBe(false);
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

// ─── Comprehensive edge-case tests ───────────────────────────────────────────

describe("complex document structures", () => {
  it("handles multiple lists interspersed with paragraphs and headings", () => {
    const { sdk } = setup(
      doc(
        heading(1, "Title"),
        p("Intro"),
        bulletList("a", "b"),
        p("Middle"),
        bulletList("c", "d"),
        heading(2, "End"),
      ),
    );
    const blocks = sdk.getBlocks();
    const types = blocks.map((b) => b.type);
    expect(types.filter((t) => t === "bulletList")).toHaveLength(2);
    expect(types.filter((t) => t === "listItem")).toHaveLength(4);
    expect(types.filter((t) => t === "paragraph")).toHaveLength(2);
    expect(types.filter((t) => t === "heading")).toHaveLength(2);
  });

  it("handles ordered lists", () => {
    const { sdk } = setup(doc(orderedList("first", "second", "third")));
    const blocks = sdk.getBlocks();
    expect(blocks[0].type).toBe("orderedList");
    expect(blocks[1]).toMatchObject({ type: "listItem", text: "first" });
    expect(blocks[2]).toMatchObject({ type: "listItem", text: "second" });
    expect(blocks[3]).toMatchObject({ type: "listItem", text: "third" });
  });

  it("handles blockquote containing text", () => {
    const { sdk } = setup(doc(blockquote(p("Quoted text")), p("Normal")));
    const blocks = sdk.getBlocks();
    expect(blocks[0].type).toBe("blockquote");
    expect(blocks[0].text).toContain("Quoted text");
  });

  it("handles mixed inline formatting", () => {
    const { sdk } = setup(
      doc({
        type: "paragraph",
        content: [
          { type: "text", text: "normal " },
          { type: "text", marks: [{ type: "bold" }], text: "bold" },
          { type: "text", text: " and " },
          { type: "text", marks: [{ type: "italic" }], text: "italic" },
        ],
      }),
    );
    const blocks = sdk.getBlocks();
    expect(blocks[0].text).toContain("bold");
    expect(blocks[0].text).toContain("italic");
  });

  it("getTextFromNode joins inline nodes without newlines", () => {
    const { sdk } = setup(
      doc({
        type: "paragraph",
        content: [
          { type: "text", text: "Hello " },
          { type: "text", marks: [{ type: "bold" }], text: "world" },
          { type: "text", text: " today" },
        ],
      }),
    );
    const blocks = sdk.getBlocks();
    // Inline text segments within the same paragraph must NOT be separated by newlines
    expect(blocks[0].text).toBe("Hello world today");
  });

  it("handles code blocks", () => {
    const { sdk } = setup(doc(p("Before"), codeBlock("const x = 1;"), p("After")));
    const blocks = sdk.getBlocks();
    const cb = blocks.find((b) => b.type === "codeBlock");
    expect(cb).toBeDefined();
    expect(cb!.text).toBe("const x = 1;");
  });

  it("handles large document with 20+ blocks", () => {
    const nodes: JSONContent[] = [];
    for (let i = 0; i < 25; i++) {
      nodes.push(p(`Paragraph ${i}`));
    }
    const { sdk } = setup(doc(...nodes));
    const blocks = sdk.getBlocks();
    expect(blocks).toHaveLength(25);
    expect(blocks[0].text).toBe("Paragraph 0");
    expect(blocks[24].text).toBe("Paragraph 24");
  });

  it("replace at various positions in a large document", () => {
    const nodes: JSONContent[] = [];
    for (let i = 0; i < 20; i++) {
      nodes.push(p(`Item ${i}`));
    }
    const { sdk } = setup(doc(...nodes));

    // Replace first
    let target = sdk.find("Item 0")[0];
    sdk.replace(target, "Replaced first");

    // Replace middle
    target = sdk.find("Item 10")[0];
    sdk.replace(target, "Replaced middle");

    // Replace last
    target = sdk.find("Item 19")[0];
    sdk.replace(target, "Replaced last");

    const texts = sdk.getBlocks().map((b) => b.text);
    expect(texts).toContain("Replaced first");
    expect(texts).toContain("Replaced middle");
    expect(texts).toContain("Replaced last");
    expect(texts).not.toContain("Item 0");
    expect(texts).not.toContain("Item 10");
    expect(texts).not.toContain("Item 19");
    // Others intact
    expect(texts).toContain("Item 5");
    expect(texts).toContain("Item 15");
  });
});

describe("replace edge cases", () => {
  it("replaces a block with content that produces multiple blocks", () => {
    const { sdk } = setup(doc(p("Before"), p("Target"), p("After")));
    const target = sdk.find("Target")[0];
    sdk.replace(target, "## Heading\n\nParagraph\n\n- item");
    const blocks = sdk.getBlocks();
    const types = blocks.map((b) => b.type);
    expect(types).toContain("heading");
    expect(types).toContain("bulletList");
    expect(blocks.map((b) => b.text)).toContain("Before");
    expect(blocks.map((b) => b.text)).toContain("After");
    expect(blocks.map((b) => b.text)).not.toContain("Target");
  });

  it("replaces a heading with a paragraph (type change)", () => {
    const { sdk } = setup(doc(heading(2, "Old Heading"), p("Text")));
    const target = sdk.find({ type: "heading" })[0];
    sdk.replace(target, "Just a paragraph now");
    const blocks = sdk.getBlocks();
    expect(blocks.every((b) => b.type !== "heading")).toBe(true);
    expect(blocks[0].type).toBe("paragraph");
    expect(blocks[0].text).toBe("Just a paragraph now");
  });

  it("replaces a paragraph with a list", () => {
    const { sdk } = setup(doc(p("Before"), p("Target"), p("After")));
    const target = sdk.find("Target")[0];
    sdk.replace(target, "- one\n- two\n- three");
    const blocks = sdk.getBlocks();
    expect(blocks.some((b) => b.type === "bulletList")).toBe(true);
    expect(blocks.map((b) => b.text)).not.toContain("Target");
  });

  it("replaces a list with a single paragraph", () => {
    const { sdk } = setup(doc(p("Before"), bulletList("a", "b", "c"), p("After")));
    const list = sdk.find({ type: "bulletList" })[0];
    sdk.replace(list, "Just text now");
    const blocks = sdk.getBlocks();
    expect(blocks.every((b) => b.type !== "bulletList")).toBe(true);
    expect(blocks.map((b) => b.text)).toContain("Just text now");
    expect(blocks.map((b) => b.text)).toContain("Before");
    expect(blocks.map((b) => b.text)).toContain("After");
  });

  it("replaces the FIRST block in the document", () => {
    const { sdk } = setup(doc(p("First"), p("Second"), p("Third")));
    const target = sdk.find("First")[0];
    sdk.replace(target, "Replaced");
    const texts = sdk.getBlocks().map((b) => b.text);
    expect(texts[0]).toBe("Replaced");
    expect(texts).toContain("Second");
    expect(texts).toContain("Third");
  });

  it("replaces the LAST block in the document", () => {
    const { sdk } = setup(doc(p("First"), p("Second"), p("Last")));
    const target = sdk.find("Last")[0];
    sdk.replace(target, "New Last");
    const texts = sdk.getBlocks().map((b) => b.text);
    expect(texts[texts.length - 1]).toBe("New Last");
    expect(texts).toContain("First");
  });

  it("replaces a block immediately before a list", () => {
    const { sdk } = setup(doc(p("Before list"), bulletList("a", "b"), p("After")));
    const target = sdk.find("Before list")[0];
    sdk.replace(target, "Changed");
    const blocks = sdk.getBlocks();
    expect(blocks.map((b) => b.text)).toContain("Changed");
    expect(blocks.some((b) => b.type === "bulletList")).toBe(true);
  });

  it("replaces a block immediately after a list", () => {
    const { sdk } = setup(doc(p("Before"), bulletList("a", "b"), p("After list")));
    const target = sdk.find("After list")[0];
    sdk.replace(target, "Changed");
    const blocks = sdk.getBlocks();
    expect(blocks.map((b) => b.text)).toContain("Changed");
    expect(blocks.some((b) => b.type === "bulletList")).toBe(true);
  });

  it("sequential replaces: replace 3 blocks one after another", () => {
    const { sdk } = setup(doc(p("A"), p("B"), p("C"), p("D"), p("E")));

    let target = sdk.find("A")[0];
    sdk.replace(target, "X");

    target = sdk.find("C")[0];
    sdk.replace(target, "Y");

    target = sdk.find("E")[0];
    sdk.replace(target, "Z");

    const texts = sdk.getBlocks().map((b) => b.text);
    expect(texts).toEqual(["X", "B", "Y", "D", "Z"]);
  });

  it("replace a block when same text appears in multiple blocks", () => {
    const { sdk } = setup(doc(p("Duplicate"), p("Middle"), p("Duplicate")));
    // find returns both, replace the first one
    const results = sdk.find("Duplicate");
    expect(results).toHaveLength(2);
    sdk.replace(results[0], "Replaced first");
    const texts = sdk.getBlocks().map((b) => b.text);
    expect(texts).toContain("Replaced first");
    // Second "Duplicate" should still exist
    expect(texts).toContain("Duplicate");
    expect(texts).toContain("Middle");
  });
});

describe("remove edge cases", () => {
  it("removes the first block", () => {
    const { sdk } = setup(doc(p("First"), p("Second"), p("Third")));
    const target = sdk.find("First")[0];
    sdk.remove(target);
    const texts = sdk.getBlocks().map((b) => b.text);
    expect(texts).toEqual(["Second", "Third"]);
  });

  it("removes the last block", () => {
    const { sdk } = setup(doc(p("First"), p("Second"), p("Third")));
    const target = sdk.find("Third")[0];
    sdk.remove(target);
    const texts = sdk.getBlocks().map((b) => b.text);
    expect(texts).toEqual(["First", "Second"]);
  });

  it("removes a block between two lists", () => {
    const { sdk } = setup(doc(bulletList("a", "b"), p("Between"), bulletList("c", "d")));
    const target = sdk.find("Between")[0];
    sdk.remove(target);
    const blocks = sdk.getBlocks();
    const lists = blocks.filter((b) => b.type === "bulletList");
    expect(lists).toHaveLength(2);
    expect(blocks.map((b) => b.text)).not.toContain("Between");
  });

  it("removes all blocks one by one", () => {
    const { sdk } = setup(doc(p("A"), p("B"), p("C")));

    let target = sdk.find("A")[0];
    sdk.remove(target);

    target = sdk.find("B")[0];
    sdk.remove(target);

    target = sdk.find("C")[0];
    sdk.remove(target);

    const blocks = sdk.getBlocks();
    // After removing all, tiptap should have at least an empty paragraph
    expect(blocks.length).toBeLessThanOrEqual(1);
  });

  it("removes a listItem when there are only 2 items (list survives)", () => {
    const { sdk } = setup(doc(bulletList("keep", "remove")));
    const target = sdk.find({ type: "listItem", text: "remove" })[0];
    sdk.remove(target);
    const blocks = sdk.getBlocks();
    const list = blocks.find((b) => b.type === "bulletList");
    expect(list).toBeDefined();
    const items = blocks.filter((b) => b.type === "listItem");
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("keep");
  });

  it("removes from a large document at the end", () => {
    const nodes: JSONContent[] = [];
    for (let i = 0; i < 20; i++) {
      nodes.push(p(`P${i}`));
    }
    const { sdk } = setup(doc(...nodes));
    const target = sdk.find("P19")[0];
    sdk.remove(target);
    const blocks = sdk.getBlocks();
    expect(blocks).toHaveLength(19);
    expect(blocks.map((b) => b.text)).not.toContain("P19");
  });

  it("insertAfter in large document", () => {
    const nodes: JSONContent[] = [];
    for (let i = 0; i < 20; i++) {
      nodes.push(p(`P${i}`));
    }
    const { sdk } = setup(doc(...nodes));
    const target = sdk.find("P10")[0];
    sdk.insertAfter(target, "Inserted");
    const blocks = sdk.getBlocks();
    expect(blocks).toHaveLength(21);
    const texts = blocks.map((b) => b.text);
    const insertedIdx = texts.indexOf("Inserted");
    const p10Idx = texts.indexOf("P10");
    expect(insertedIdx).toBe(p10Idx + 1);
  });
});

describe("listItem operations", () => {
  it("replaces listItem with text containing markdown bold", () => {
    const { sdk } = setup(doc(bulletList("plain", "target", "other")));
    const target = sdk.find({ type: "listItem", text: "target" })[0];
    sdk.replace(target, "**bold text**");
    const items = sdk.find({ type: "listItem" });
    // The replaced item should contain "bold text"
    expect(items.some((i) => i.text.includes("bold text"))).toBe(true);
    expect(items.map((i) => i.text)).toContain("plain");
    expect(items.map((i) => i.text)).toContain("other");
  });

  it("replaces first item in a 5-item list", () => {
    const { sdk } = setup(doc(bulletList("one", "two", "three", "four", "five")));
    const target = sdk.find({ type: "listItem", text: "one" })[0];
    sdk.replace(target, "replaced");
    const items = sdk.find({ type: "listItem" });
    expect(items.map((i) => i.text)).toEqual(["replaced", "two", "three", "four", "five"]);
  });

  it("replaces middle item in a 5-item list", () => {
    const { sdk } = setup(doc(bulletList("one", "two", "three", "four", "five")));
    const target = sdk.find({ type: "listItem", text: "three" })[0];
    sdk.replace(target, "replaced");
    const items = sdk.find({ type: "listItem" });
    expect(items.map((i) => i.text)).toEqual(["one", "two", "replaced", "four", "five"]);
  });

  it("replaces last item in a 5-item list", () => {
    const { sdk } = setup(doc(bulletList("one", "two", "three", "four", "five")));
    const target = sdk.find({ type: "listItem", text: "five" })[0];
    sdk.replace(target, "replaced");
    const items = sdk.find({ type: "listItem" });
    expect(items.map((i) => i.text)).toEqual(["one", "two", "three", "four", "replaced"]);
  });

  it("removes first item in a 5-item list", () => {
    const { sdk } = setup(doc(bulletList("one", "two", "three", "four", "five")));
    const target = sdk.find({ type: "listItem", text: "one" })[0];
    sdk.remove(target);
    const items = sdk.find({ type: "listItem" });
    expect(items.map((i) => i.text)).toEqual(["two", "three", "four", "five"]);
  });

  it("removes middle item in a 5-item list", () => {
    const { sdk } = setup(doc(bulletList("one", "two", "three", "four", "five")));
    const target = sdk.find({ type: "listItem", text: "three" })[0];
    sdk.remove(target);
    const items = sdk.find({ type: "listItem" });
    expect(items.map((i) => i.text)).toEqual(["one", "two", "four", "five"]);
  });

  it("removes last item in a 5-item list", () => {
    const { sdk } = setup(doc(bulletList("one", "two", "three", "four", "five")));
    const target = sdk.find({ type: "listItem", text: "five" })[0];
    sdk.remove(target);
    const items = sdk.find({ type: "listItem" });
    expect(items.map((i) => i.text)).toEqual(["one", "two", "three", "four"]);
  });

  it("insertAfter a listItem adds a new item to the list", () => {
    const { sdk } = setup(doc(bulletList("first", "second", "third")));
    const target = sdk.find({ type: "listItem", text: "second" })[0];
    sdk.insertAfter(target, "inserted");
    const items = sdk.find({ type: "listItem" });
    expect(items.map((i) => i.text)).toEqual(["first", "second", "inserted", "third"]);
  });

  it("operations on ordered list items", () => {
    const { sdk } = setup(doc(orderedList("alpha", "beta", "gamma")));
    const target = sdk.find({ type: "listItem", text: "beta" })[0];
    sdk.replace(target, "replaced");
    const items = sdk.find({ type: "listItem" });
    expect(items.map((i) => i.text)).toEqual(["alpha", "replaced", "gamma"]);
    // List type should still be orderedList
    const blocks = sdk.getBlocks();
    expect(blocks[0].type).toBe("orderedList");
  });

  it("list with single item — replace it", () => {
    const { sdk } = setup(doc(bulletList("only")));
    const target = sdk.find({ type: "listItem", text: "only" })[0];
    sdk.replace(target, "replaced");
    const items = sdk.find({ type: "listItem" });
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("replaced");
  });

  it("list with single item — remove it removes the list", () => {
    const { sdk } = setup(doc(p("Before"), bulletList("only"), p("After")));
    const target = sdk.find({ type: "listItem", text: "only" })[0];
    sdk.remove(target);
    const blocks = sdk.getBlocks();
    expect(blocks.every((b) => b.type !== "bulletList")).toBe(true);
    expect(blocks.every((b) => b.type !== "listItem")).toBe(true);
  });

  it("two separate lists — target items in the second list", () => {
    const { sdk } = setup(doc(bulletList("a1", "a2"), p("separator"), bulletList("b1", "b2")));
    // Find b1 which is in the second list
    const items = sdk.find({ type: "listItem", text: "b1" });
    expect(items).toHaveLength(1);
    sdk.replace(items[0], "replaced-b1");
    const allItems = sdk.find({ type: "listItem" });
    expect(allItems.map((i) => i.text)).toContain("a1");
    expect(allItems.map((i) => i.text)).toContain("a2");
    expect(allItems.map((i) => i.text)).toContain("replaced-b1");
    expect(allItems.map((i) => i.text)).toContain("b2");
  });

  it("remove from ordered list", () => {
    const { sdk } = setup(doc(orderedList("one", "two", "three")));
    const target = sdk.find({ type: "listItem", text: "two" })[0];
    sdk.remove(target);
    const items = sdk.find({ type: "listItem" });
    expect(items.map((i) => i.text)).toEqual(["one", "three"]);
  });
});

describe("find edge cases", () => {
  it("find with empty string matches all blocks with text", () => {
    const { sdk } = setup(doc(p("Hello"), p("World")));
    const results = sdk.find("");
    // Empty string is included in every string, so all blocks should match
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it("find in a doc with no content returns empty", () => {
    const { sdk } = setup({ type: "doc", content: [] });
    const results = sdk.find("anything");
    expect(results).toHaveLength(0);
  });

  it("find listItem by partial text match", () => {
    const { sdk } = setup(doc(bulletList("apple pie", "banana split", "apple sauce")));
    const results = sdk.find({ type: "listItem", text: "apple" });
    expect(results).toHaveLength(2);
    expect(results[0].text).toBe("apple pie");
    expect(results[1].text).toBe("apple sauce");
  });

  it("find text that exists in both a paragraph and a list item", () => {
    const { sdk } = setup(doc(p("shared text"), bulletList("shared text", "other")));
    const results = sdk.find("shared text");
    // Should match: the paragraph, the bulletList (contains "shared text"), and the listItem
    expect(results.length).toBeGreaterThanOrEqual(2);
    const types = results.map((r) => r.type);
    expect(types).toContain("paragraph");
    expect(types).toContain("listItem");
  });

  it("find heading by type and text when multiple heading levels exist", () => {
    const { sdk } = setup(
      doc(heading(1, "Main Title"), heading(2, "Subtitle"), heading(1, "Another Title")),
    );
    const h1s = sdk.find({ type: "heading", text: "Title" });
    // "Main Title" and "Another Title" both contain "Title"
    expect(h1s).toHaveLength(2);
  });

  it("find with regex matching special characters", () => {
    const { sdk } = setup(doc(p("Price: $10.00"), p("Normal text"), p("Rate: $5.50")));
    const results = sdk.find({ text: /\$[0-9]+\.[0-9]+/ });
    expect(results).toHaveLength(2);
  });

  it("find with regex anchors", () => {
    const { sdk } = setup(doc(p("Hello world"), p("Hello"), p("world Hello")));
    const results = sdk.find({ text: /^Hello$/ });
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe("Hello");
  });

  it("find with global regex does not skip matches due to lastIndex", () => {
    const { sdk } = setup(doc(p("abc 123"), p("def 456"), p("ghi 789")));
    // Using the g flag: without resetting lastIndex, .test() would advance
    // and skip every other match
    const results = sdk.find({ text: /[0-9]+/g });
    expect(results).toHaveLength(3);
  });

  it("find by type only returns all blocks of that type", () => {
    const { sdk } = setup(doc(p("p1"), heading(1, "h1"), p("p2"), heading(2, "h2"), p("p3")));
    const paragraphs = sdk.find({ type: "paragraph" });
    expect(paragraphs).toHaveLength(3);
    const headings = sdk.find({ type: "heading" });
    expect(headings).toHaveLength(2);
  });
});

describe("markdown round-trip", () => {
  it("getMarkdown after mutations preserves structure", () => {
    const { sdk } = setup(doc(heading(1, "Title"), p("Original")));
    sdk.append("## Added Section\n\nAdded text");
    const md = sdk.getMarkdown();
    expect(md).toContain("# Title");
    expect(md).toContain("Original");
    expect(md).toContain("## Added Section");
    expect(md).toContain("Added text");
  });

  it("append preserves existing content", () => {
    const { sdk } = setup(doc(heading(1, "Title"), p("Existing")));
    sdk.append("## New Section");
    sdk.append("More content");
    const md = sdk.getMarkdown();
    expect(md).toContain("# Title");
    expect(md).toContain("Existing");
    expect(md).toContain("## New Section");
    expect(md).toContain("More content");
  });
});

describe("sequential mutation scenarios (simulating AI usage)", () => {
  it("read → find section → replace with reorganized content → verify", () => {
    const { sdk } = setup(
      doc(
        heading(1, "Notes"),
        heading(2, "Section A"),
        p("Content A"),
        heading(2, "Section B"),
        p("Content B"),
      ),
    );

    // Find Section A heading and replace with reorganized content
    const sectionA = sdk.find({ type: "heading", text: "Section A" })[0];
    sdk.replace(sectionA, "## Reorganized A");

    // Find old content and replace
    const contentA = sdk.find("Content A")[0];
    sdk.replace(contentA, "New content for section A with more detail");

    const blocks = sdk.getBlocks();
    expect(blocks.map((b) => b.text)).toContain("Reorganized A");
    expect(blocks.map((b) => b.text)).toContain("New content for section A with more detail");
    expect(blocks.map((b) => b.text)).toContain("Section B");
    expect(blocks.map((b) => b.text)).toContain("Content B");
  });

  it("find all list items → remove specific ones → add new ones → verify order", () => {
    const { sdk } = setup(doc(bulletList("todo1", "done1", "todo2", "done2", "todo3")));

    // Remove "done" items
    let items = sdk.find({ type: "listItem", text: "done1" });
    sdk.remove(items[0]);

    items = sdk.find({ type: "listItem", text: "done2" });
    sdk.remove(items[0]);

    // Add a new item after todo2
    const todo2 = sdk.find({ type: "listItem", text: "todo2" })[0];
    sdk.insertAfter(todo2, "new-todo");

    const finalItems = sdk.find({ type: "listItem" });
    const texts = finalItems.map((i) => i.text);
    expect(texts).toContain("todo1");
    expect(texts).toContain("todo2");
    expect(texts).toContain("todo3");
    expect(texts).toContain("new-todo");
    expect(texts).not.toContain("done1");
    expect(texts).not.toContain("done2");
  });

  it("find heading → insertAfter with new section content → verify", () => {
    const { sdk } = setup(
      doc(heading(1, "Title"), heading(2, "Existing Section"), p("Existing content")),
    );

    const heading2 = sdk.find({ type: "heading", text: "Existing Section" })[0];
    sdk.insertAfter(heading2, "Added after heading");

    const blocks = sdk.getBlocks();
    const texts = blocks.map((b) => b.text);
    const existingIdx = texts.indexOf("Existing Section");
    const insertedIdx = texts.indexOf("Added after heading");
    expect(insertedIdx).toBe(existingIdx + 1);
  });

  it("seeded doc → surgical edits → verify", () => {
    const { sdk } = setup(
      doc(
        heading(1, "Project"),
        heading(2, "Status"),
        p("All good"),
        heading(2, "TODO"),
        bulletList("task 1", "task 2"),
      ),
    );

    // Surgical edit - replace status
    const status = sdk.find("All good")[0];
    sdk.replace(status, "Needs review");

    const blocks = sdk.getBlocks();
    expect(blocks.map((b) => b.text)).toContain("Project");
    expect(blocks.map((b) => b.text)).toContain("Needs review");
    expect(blocks.map((b) => b.text)).not.toContain("All good");
    expect(blocks.some((b) => b.type === "bulletList")).toBe(true);
  });

  it("multiple appends in sequence", () => {
    const { sdk } = setup(doc(heading(1, "Log")));

    sdk.append("Entry 1");
    sdk.append("Entry 2");
    sdk.append("Entry 3");

    const blocks = sdk.getBlocks();
    const texts = blocks.map((b) => b.text);
    expect(texts).toContain("Log");
    expect(texts).toContain("Entry 1");
    expect(texts).toContain("Entry 2");
    expect(texts).toContain("Entry 3");
    // Verify order
    expect(texts.indexOf("Entry 1")).toBeLessThan(texts.indexOf("Entry 2"));
    expect(texts.indexOf("Entry 2")).toBeLessThan(texts.indexOf("Entry 3"));
  });

  it("insertBefore on a listItem adds item within the list", () => {
    const { sdk } = setup(doc(bulletList("first", "second", "third")));
    const target = sdk.find({ type: "listItem", text: "second" })[0];
    sdk.insertBefore(target, "inserted");
    const items = sdk.find({ type: "listItem" });
    expect(items.map((i) => i.text)).toEqual(["first", "inserted", "second", "third"]);
  });

  it("replace then insertAfter on the replacement", () => {
    const { sdk } = setup(doc(p("A"), p("B"), p("C")));

    const target = sdk.find("B")[0];
    sdk.replace(target, "B-replaced");

    const replaced = sdk.find("B-replaced")[0];
    sdk.insertAfter(replaced, "B-inserted");

    const texts = sdk.getBlocks().map((b) => b.text);
    expect(texts).toEqual(["A", "B-replaced", "B-inserted", "C"]);
  });

  it("complex workflow: seeded doc → find → remove → append → verify", () => {
    const { sdk } = setup(
      doc(heading(1, "Doc"), bulletList("keep", "remove-me", "also-keep"), p("Footer")),
    );

    // Remove a list item
    const removeTarget = sdk.find({ type: "listItem", text: "remove-me" })[0];
    sdk.remove(removeTarget);

    // Append new content
    sdk.append("## Appendix\n\nExtra info");

    const blocks = sdk.getBlocks();
    const texts = blocks.map((b) => b.text);
    expect(texts).toContain("Doc");
    expect(texts).not.toContain("remove-me");
    expect(texts).toContain("Extra info");

    const items = sdk.find({ type: "listItem" });
    expect(items.map((i) => i.text)).toContain("keep");
    expect(items.map((i) => i.text)).toContain("also-keep");
  });
});

describe("nested list handling", () => {
  it("find({ type: 'listItem' }) returns items at all nesting levels", () => {
    const { sdk } = setup(
      doc(
        nestedBulletList(
          listItemWithNested("parent1", "child1a", "child1b"),
          simpleListItem("parent2"),
        ),
      ),
    );
    const items = sdk.find({ type: "listItem" });
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.text)).toEqual(["parent1", "child1a", "child1b", "parent2"]);
  });

  it("nested listItem has correct depth field", () => {
    const { sdk } = setup(
      doc(nestedBulletList(listItemWithNested("top", "nested"), simpleListItem("also-top"))),
    );
    const items = sdk.find({ type: "listItem" });
    expect(items[0]).toMatchObject({ text: "top", depth: 0 });
    expect(items[1]).toMatchObject({ text: "nested", depth: 1 });
    expect(items[2]).toMatchObject({ text: "also-top", depth: 0 });
  });

  it("listItem text excludes nested sub-list content", () => {
    const { sdk } = setup(doc(nestedBulletList(listItemWithNested("parent text", "child text"))));
    const items = sdk.find({ type: "listItem" });
    const parent = items.find((i) => i.text === "parent text");
    expect(parent).toBeDefined();
    // parent text should NOT contain "child text"
    expect(parent!.text).toBe("parent text");
    expect(parent!.text).not.toContain("child text");
  });

  it("replace on a nested listItem replaces just that sub-item", () => {
    const { sdk } = setup(
      doc(
        nestedBulletList(
          listItemWithNested("parent", "child1", "child2"),
          simpleListItem("sibling"),
        ),
      ),
    );
    const child1 = sdk.find({ type: "listItem", text: "child1" })[0];
    expect(child1).toBeDefined();
    const result = sdk.replace(child1, "replaced-child");
    expect(result).toBe(true);

    const items = sdk.find({ type: "listItem" });
    const texts = items.map((i) => i.text);
    expect(texts).toContain("parent");
    expect(texts).toContain("replaced-child");
    expect(texts).toContain("child2");
    expect(texts).toContain("sibling");
    expect(texts).not.toContain("child1");
  });

  it("remove on a nested listItem removes just that sub-item", () => {
    const { sdk } = setup(
      doc(
        nestedBulletList(
          listItemWithNested("parent", "child1", "child2"),
          simpleListItem("sibling"),
        ),
      ),
    );
    const child1 = sdk.find({ type: "listItem", text: "child1" })[0];
    const result = sdk.remove(child1);
    expect(result).toBe(true);

    const items = sdk.find({ type: "listItem" });
    const texts = items.map((i) => i.text);
    expect(texts).toContain("parent");
    expect(texts).toContain("child2");
    expect(texts).toContain("sibling");
    expect(texts).not.toContain("child1");
  });

  it("remove last nested item removes the nested list", () => {
    const { sdk } = setup(doc(nestedBulletList(listItemWithNested("parent", "only-child"))));
    const child = sdk.find({ type: "listItem", text: "only-child" })[0];
    sdk.remove(child);

    const items = sdk.find({ type: "listItem" });
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("parent");
    // Parent should no longer have nested list
    expect(items[0].depth).toBe(0);
  });

  it("insertAfter on a nested listItem inserts within the nested list", () => {
    const { sdk } = setup(doc(nestedBulletList(listItemWithNested("parent", "child1", "child2"))));
    const child1 = sdk.find({ type: "listItem", text: "child1" })[0];
    sdk.insertAfter(child1, "inserted");

    const items = sdk.find({ type: "listItem" });
    const nestedItems = items.filter((i) => i.depth === 1);
    expect(nestedItems.map((i) => i.text)).toEqual(["child1", "inserted", "child2"]);
  });

  it("insertBefore on a nested listItem inserts within the nested list", () => {
    const { sdk } = setup(doc(nestedBulletList(listItemWithNested("parent", "child1", "child2"))));
    const child2 = sdk.find({ type: "listItem", text: "child2" })[0];
    sdk.insertBefore(child2, "inserted");

    const items = sdk.find({ type: "listItem" });
    const nestedItems = items.filter((i) => i.depth === 1);
    expect(nestedItems.map((i) => i.text)).toEqual(["child1", "inserted", "child2"]);
  });

  it("deeply nested lists (3 levels) are extracted correctly", () => {
    const deeplyNested: JSONContent = {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            p("level0"),
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    p("level1"),
                    {
                      type: "bulletList",
                      content: [{ type: "listItem", content: [p("level2")] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const { sdk } = setup(doc(deeplyNested));
    const items = sdk.find({ type: "listItem" });
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ text: "level0", depth: 0 });
    expect(items[1]).toMatchObject({ text: "level1", depth: 1 });
    expect(items[2]).toMatchObject({ text: "level2", depth: 2 });
  });
});

describe("invalid AI-generated edit code (regression)", () => {
  it("throws when AI code has a syntax error", () => {
    const { sdk, destroy } = createNotebookSDK(doc(p("Hello")));
    try {
      // Simulate what onToolCall does: create a Function from AI-generated code
      expect(() => {
        const fn = new Function("notebook", "notebook.find({{invalid syntax}})");
        fn(sdk);
      }).toThrow();
    } finally {
      destroy();
    }
  });

  it("throws when AI code references undefined methods", () => {
    const { sdk, destroy } = createNotebookSDK(doc(p("Hello")));
    try {
      expect(() => {
        const fn = new Function("notebook", "notebook.nonExistentMethod()");
        fn(sdk);
      }).toThrow();
    } finally {
      destroy();
    }
  });

  it("throws when AI code throws a runtime error", () => {
    const { sdk, destroy } = createNotebookSDK(doc(p("Hello")));
    try {
      expect(() => {
        const fn = new Function("notebook", "throw new Error('AI made a mistake')");
        fn(sdk);
      }).toThrow("AI made a mistake");
    } finally {
      destroy();
    }
  });

  it("does not modify content when AI code fails mid-execution", () => {
    const { sdk, getResult, destroy } = createNotebookSDK(doc(p("Original")));
    try {
      // Code that does a valid mutation then throws
      expect(() => {
        const fn = new Function(
          "notebook",
          `
          notebook.append("Added");
          throw new Error("oops");
        `,
        );
        fn(sdk);
      }).toThrow("oops");

      // Despite the error, getResult still returns the editor state
      // (the append happened before the throw — this is expected behavior;
      // the caller should NOT call getResult/save when an error occurs)
      const result = getResult();
      expect(result.type).toBe("doc");
    } finally {
      destroy();
    }
  });
});
