import { describe, expect, it } from "vitest";
import { segmentParts } from "../chat-message-segments";

describe("segmentParts", () => {
  it("keeps activity between answer paragraphs without changing the input parts", () => {
    const segments = segmentParts([
      { type: "step-start" },
      { type: "reasoning", text: "Check the chapter." },
      {
        type: "tool-search_book",
        toolCallId: "search",
        state: "output-available",
        input: {},
        output: [],
      },
      { type: "text", text: "First" },
      { type: "text", text: "paragraph." },
      {
        type: "tool-create_highlight",
        toolCallId: "highlight",
        state: "input-available",
        input: { text: "masks" },
      },
      { type: "text", text: "Second." },
    ]);
    expect(segments.map((segment) => segment.type)).toEqual(["steps", "text", "steps", "text"]);
    expect(segments[0].type === "steps" && segments[0].parts.map((part) => part.type)).toEqual([
      "reasoning",
      "tool-search_book",
    ]);
    expect(segments[1].type === "text" && segments[1].text).toBe("First paragraph.");
  });

  it("drops empty content but preserves reasoning that has just started streaming", () => {
    const segments = segmentParts([
      { type: "text", text: "" },
      { type: "reasoning", text: "  ", state: "done" },
      { type: "reasoning", text: "", state: "streaming" },
      {
        type: "dynamic-tool",
        toolName: "x",
        toolCallId: "x",
        input: {},
        state: "output-available",
        output: {},
      },
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0].type === "steps" && segments[0].parts).toHaveLength(2);
  });
});
