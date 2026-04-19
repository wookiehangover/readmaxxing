import { describe, it, expect } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { runEditNotesInSandbox } from "../notebook-sdk-server";

function p(text: string): JSONContent {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function doc(...content: JSONContent[]): JSONContent {
  return { type: "doc", content };
}

describe("runEditNotesInSandbox", () => {
  it("does not expose setContent on the sandboxed notebook", async () => {
    const input = doc(p("one"), p("two"), p("three"), p("four"), p("five"));
    const result = await runEditNotesInSandbox(
      input,
      "if (typeof notebook.setContent === 'function') throw new Error('setContent was exposed');",
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a script that wipes the notebook down to a tiny residual", async () => {
    // Seed with 10 top-level blocks; script reassembles to ~2 blocks, which
    // is below the 25% floor (10 * 0.25 = 2.5). The guard should reject.
    const input = doc(
      p("b1"),
      p("b2"),
      p("b3"),
      p("b4"),
      p("b5"),
      p("b6"),
      p("b7"),
      p("b8"),
      p("b9"),
      p("b10"),
    );
    const code = `
      // Simulate the reported failure mode: an AI rebuilds the doc via remove()
      // calls and then tries to write a single block back with append().
      const blocks = notebook.getBlocks();
      for (const b of blocks) { notebook.remove(b); }
      notebook.append("only this");
    `;
    const result = await runEditNotesInSandbox(input, code);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("edit_notes");
      expect(result.error).toMatch(/reduced the notebook from 10 blocks/);
    }
  });

  it("allows replace() on one of five blocks", async () => {
    const input = doc(p("one"), p("two"), p("three"), p("four"), p("five"));
    const code = `
      const target = notebook.find("three")[0];
      if (target) notebook.replace(target, "replaced");
    `;
    const result = await runEditNotesInSandbox(input, code);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const texts = (result.updatedContent.content ?? []).map((n) => n.content?.[0]?.text ?? "");
      expect(texts).toEqual(["one", "two", "replaced", "four", "five"]);
    }
  });

  it("allows a legitimate bulk removal above the shrink floor", async () => {
    // 5 blocks → 2 blocks is above the 25% floor (5 * 0.25 = 1.25), so fine.
    const input = doc(p("one"), p("two"), p("three"), p("four"), p("five"));
    const code = `
      const blocks = notebook.getBlocks();
      notebook.remove(blocks[4]);
      notebook.remove(blocks[3]);
      notebook.remove(blocks[2]);
    `;
    const result = await runEditNotesInSandbox(input, code);
    expect(result.ok).toBe(true);
  });

  it("does not run the guard when input had fewer than 3 blocks", async () => {
    // Input has 2 blocks → guard is disabled so we do not false-positive on
    // small notebooks where shrinking to 1 block is a legitimate outcome.
    const input = doc(p("one"), p("two"));
    const code = `
      const blocks = notebook.getBlocks();
      notebook.remove(blocks[1]);
    `;
    const result = await runEditNotesInSandbox(input, code);
    expect(result.ok).toBe(true);
  });

  it("propagates errors from the sandboxed script", async () => {
    const input = doc(p("one"), p("two"));
    const result = await runEditNotesInSandbox(input, "throw new Error('boom');");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("boom");
    }
  });
});
