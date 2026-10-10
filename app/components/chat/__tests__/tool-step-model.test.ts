import { describe, expect, it } from "vitest";
import { segmentParts, toToolStep } from "../tool-steps/tool-step-model";

const ctx = {
  resolveBookTitle: (id?: string) => (id === "b2" ? "Frankenstein" : "Moby-Dick"),
  showBookLabel: false,
};

const tool = (name: string, state: string, input: object = {}, output?: object) => ({
  type: `tool-${name}`,
  toolCallId: `${name}-${state}`,
  state,
  input,
  output,
});

describe("segmentParts", () => {
  it("keeps tool runs between the text they interleave with", () => {
    const segments = segmentParts(
      [
        { type: "step-start" },
        { type: "reasoning", text: "Check chapter 42." },
        tool("search_book", "output-available", { query: "white" }, { results: [] }),
        { type: "text", text: "First" },
        { type: "text", text: "paragraph." },
        tool("create_highlight", "input-available", { text: "masks" }),
        { type: "text", text: "Second." },
      ],
      ctx,
    );

    expect(segments.map((s) => s.type)).toEqual(["steps", "text", "steps", "text"]);
    expect(segments[0].type === "steps" && segments[0].entries.map((e) => e.type)).toEqual([
      "reasoning",
      "step",
    ]);
    expect(segments[1].type === "text" && segments[1].text).toBe("First paragraph.");
  });

  it("drops empty text and blank reasoning", () => {
    const segments = segmentParts(
      [
        { type: "text", text: "" },
        { type: "reasoning", text: "  " },
        { type: "dynamic-tool", toolName: "x", state: "output-available" },
      ],
      ctx,
    );
    expect(segments).toHaveLength(1);
    expect(segments[0].type === "steps" && segments[0].entries).toHaveLength(1);
  });
});

describe("toToolStep", () => {
  it("describes running and finished searches", () => {
    expect(
      toToolStep(tool("search_book", "input-available", { query: "ahab" }), 0, ctx),
    ).toMatchObject({
      status: "running",
      verb: "Searching",
      quote: "ahab",
      meta: undefined,
    });
    expect(
      toToolStep(
        tool(
          "search_book",
          "output-available",
          { query: "ahab" },
          { results: [{ excerpt: "a" }, { excerpt: "b" }] },
        ),
        0,
        ctx,
      ),
    ).toMatchObject({ status: "done", verb: "Searched", meta: "2 passages" });
    expect(
      toToolStep(tool("search_book", "output-available", {}, { results: [] }), 0, ctx)?.meta,
    ).toBe("No matches");
  });

  it("prefers the returned chapter title and index", () => {
    expect(
      toToolStep(
        tool(
          "read_chapter",
          "output-available",
          { chapterIndex: 3 },
          { chapterIndex: 41, title: "The Whiteness" },
        ),
        0,
        ctx,
      ),
    ).toMatchObject({ object: "The Whiteness", chapterIndex: 41 });
    expect(
      toToolStep(tool("read_chapter", "input-available", { chapterIndex: 41 }), 0, ctx)?.object,
    ).toBe("Chapter 42");
  });

  it("marks failed tool results as errors with their reason", () => {
    expect(
      toToolStep(
        tool("edit_notes", "output-available", {}, { executed: false, error: "stale" }),
        0,
        ctx,
      ),
    ).toMatchObject({ status: "error", verb: "Couldn't edit", error: "stale" });
    expect(
      toToolStep(
        tool("attach_highlight", "output-available", {}, { attached: false, reason: "gone" }),
        0,
        ctx,
      ),
    ).toMatchObject({ status: "error", error: "gone" });
    expect(
      toToolStep({ ...tool("read_notes", "output-error"), errorText: "boom" }, 0, ctx),
    ).toMatchObject({
      status: "error",
      error: "boom",
    });
  });

  it("labels the book only when several books are in play", () => {
    const part = tool(
      "search_book",
      "output-available",
      { query: "q", bookId: "b2" },
      { bookId: "b2", results: [] },
    );
    expect(toToolStep(part, 0, ctx)).toMatchObject({ bookId: "b2", book: undefined });
    expect(toToolStep(part, 0, { ...ctx, showBookLabel: true })?.book).toBe("Frankenstein");
  });

  it("humanizes unknown tools", () => {
    expect(
      toToolStep(
        { type: "dynamic-tool", toolName: "fetch_reviews", state: "output-available" },
        0,
        ctx,
      ),
    ).toMatchObject({
      kind: "other",
      verb: "Fetch reviews",
    });
  });
});
