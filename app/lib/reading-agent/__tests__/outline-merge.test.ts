import { describe, expect, it } from "vitest";
import { mergeOutlineMarkdown } from "../outline-merge";

describe("mergeOutlineMarkdown", () => {
  it("creates a chapter section in an empty document", () => {
    expect(mergeOutlineMarkdown("", "One: The Question", ["The traveler leaves home."])).toBe(
      "## One: The Question\n- The traveler leaves home.",
    );
  });

  it("appends bullets to the matching chapter heading", () => {
    const current = "## One\n- First event.";
    expect(mergeOutlineMarkdown(current, "One", ["Second event.", "Third event."])).toBe(
      "## One\n- First event.\n- Second event.\n- Third event.",
    );
  });

  it("adds an unknown chapter at the end", () => {
    const current = "## One\n- First event.";
    expect(mergeOutlineMarkdown(current, "Two", ["A later event."])).toBe(
      "## One\n- First event.\n\n## Two\n- A later event.",
    );
  });

  it("deduplicates within a chapter rather than across chapters", () => {
    const current = "## One\n- A shared event.\n\n## Two\n- Existing event.";
    expect(mergeOutlineMarkdown(current, "Two", ["A shared event."])).toBe(
      "## One\n- A shared event.\n\n## Two\n- Existing event.\n- A shared event.",
    );
  });

  it("leaves other chapter text byte-for-byte unchanged", () => {
    const current = "## One\n- First event.\n\n## Two\n- Existing later event.\n";
    const merged = mergeOutlineMarkdown(current, "One", ["Another first-chapter event."]);
    expect(merged.slice(merged.indexOf("## Two"))).toBe("## Two\n- Existing later event.\n");
  });

  it("ignores empty and duplicate bullets", () => {
    const current = "## One\n- First event.";
    expect(mergeOutlineMarkdown(current, "One", ["", "First event.", "  "])).toBe(current);
    expect(mergeOutlineMarkdown("", "One", ["Repeated.", "Repeated."])).toBe("## One\n- Repeated.");
  });

  it("uses Untitled for a blank chapter label", () => {
    expect(mergeOutlineMarkdown("", "  ", ["An unlabelled event."])).toBe(
      "## Untitled\n- An unlabelled event.",
    );
  });
});
