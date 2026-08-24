import { describe, expect, it } from "vitest";
import { getOutlineChapterBullets, mergeOutlineMarkdown } from "../outline-merge";

describe("getOutlineChapterBullets", () => {
  it("returns only bullets from the matching chapter", () => {
    const outline = "## One\n- First event.\n- Second event.\n\n## Two\n- Later event.";
    expect(getOutlineChapterBullets(outline, "One")).toEqual(["First event.", "Second event."]);
    expect(getOutlineChapterBullets(outline, "Missing")).toEqual([]);
  });
});

describe("mergeOutlineMarkdown", () => {
  it("creates a chapter section in an empty document", () => {
    expect(
      mergeOutlineMarkdown("", "One: The Question", ["The traveler leaves home."], {
        locator: "chapter-1.xhtml#page=12",
        displayPage: 12,
      }),
    ).toBe(
      '## One: The Question\n\n<div data-outline-increment="" data-locator="chapter-1.xhtml#page=12" data-page="12">\n\n- The traveler leaves home.\n\n</div>',
    );
  });

  it("appends a complete increment block to the matching chapter heading", () => {
    const current = "## One\n- First event.";
    expect(
      mergeOutlineMarkdown(current, "One", ["Second event.", "Third event."], {
        locator: 'chapter-1.xhtml?mode=wide&name="One"',
        displayPage: 13,
      }),
    ).toBe(
      '## One\n- First event.\n\n<div data-outline-increment="" data-locator="chapter-1.xhtml?mode=wide&amp;name=&quot;One&quot;" data-page="13">\n\n- Second event.\n- Third event.\n\n</div>',
    );
  });

  it("inserts before the first increment with a higher locator page", () => {
    const current =
      '## One\nUser-edited introduction.\n\n<div data-outline-increment="" data-locator="chapter-1.xhtml#page=20">\n\n- Later event.\n\n</div>';
    expect(
      mergeOutlineMarkdown(current, "One", ["Earlier event."], {
        locator: "page:10",
      }),
    ).toBe(
      '## One\nUser-edited introduction.\n\n<div data-outline-increment="" data-locator="page:10">\n\n- Earlier event.\n\n</div>\n\n<div data-outline-increment="" data-locator="chapter-1.xhtml#page=20">\n\n- Later event.\n\n</div>',
    );
  });

  it("appends when the new display page follows existing increments", () => {
    const current =
      '## One\n\n<div data-outline-increment="" data-locator="page:10" data-page="10">\n\n- Earlier event.\n\n</div>';
    expect(
      mergeOutlineMarkdown(current, "One", ["Later event."], {
        locator: "chapter-1.xhtml",
        displayPage: 20,
      }),
    ).toBe(
      `${current}\n\n<div data-outline-increment="" data-locator="chapter-1.xhtml" data-page="20">\n\n- Later event.\n\n</div>`,
    );
  });

  it("appends when the new increment has no page metadata", () => {
    const current =
      '## One\n\n<div data-outline-increment="" data-locator="page:20" data-page="20">\n\n- Paged event.\n\n</div>';
    const merged = mergeOutlineMarkdown(current, "One", ["Unpaged event."], {
      locator: "chapter-1.xhtml",
    });

    expect(merged).toBe(
      `${current}\n\n<div data-outline-increment="" data-locator="chapter-1.xhtml">\n\n- Unpaged event.\n\n</div>`,
    );
  });

  it("adds an unknown chapter at the end", () => {
    const current = "## One\n- First event.";
    expect(
      mergeOutlineMarkdown(current, "Two", ["A later event."], {
        locator: "chapter-2.xhtml#page=20",
        displayPage: 20,
      }),
    ).toBe(
      '## One\n- First event.\n\n## Two\n\n<div data-outline-increment="" data-locator="chapter-2.xhtml#page=20" data-page="20">\n\n- A later event.\n\n</div>',
    );
  });

  it("does not suppress an increment because user text already contains its bullet", () => {
    const current = "## One\n- A shared event.\n\n## Two\n- Existing event.";
    expect(
      mergeOutlineMarkdown(current, "Two", ["A shared event."], {
        locator: "chapter-2.xhtml#page=21",
      }),
    ).toBe(
      '## One\n- A shared event.\n\n## Two\n- Existing event.\n\n<div data-outline-increment="" data-locator="chapter-2.xhtml#page=21">\n\n- A shared event.\n\n</div>',
    );
  });

  it("keeps the increment when the display page is missing", () => {
    const merged = mergeOutlineMarkdown("", "One", ["An event without a page label."], {
      locator: "chapter-1.xhtml#page=unknown",
    });

    expect(merged).toContain('data-locator="chapter-1.xhtml#page=unknown"');
    expect(merged).not.toContain("data-page=");
    expect(merged).toContain("- An event without a page label.");
  });

  it("leaves other chapter text byte-for-byte unchanged", () => {
    const current = "## One\n- First event.\n\n## Two\n- Existing later event.\n";
    const merged = mergeOutlineMarkdown(current, "One", ["Another first-chapter event."], {
      locator: "chapter-1.xhtml#page=2",
      displayPage: 2,
    });
    expect(merged.slice(merged.indexOf("## Two"))).toBe("## Two\n- Existing later event.\n");
  });

  it("ignores empty bullets", () => {
    const current = "## One\n- First event.";
    expect(mergeOutlineMarkdown(current, "One", ["", "  "], { locator: "chapter-1.xhtml" })).toBe(
      current,
    );
  });

  it("uses Untitled for a blank chapter label", () => {
    expect(
      mergeOutlineMarkdown("", "  ", ["An unlabelled event."], {
        locator: "frontmatter.xhtml#page=1",
      }),
    ).toBe(
      '## Untitled\n\n<div data-outline-increment="" data-locator="frontmatter.xhtml#page=1">\n\n- An unlabelled event.\n\n</div>',
    );
  });
});
