import { describe, expect, it } from "vitest";

import { CHAPTER_WINDOW_LENGTH, readChapterWindow } from "../read-chapter-window";

describe("readChapterWindow", () => {
  it("keeps the default 15,000-character pager behavior", () => {
    const chapterText = "a".repeat(CHAPTER_WINDOW_LENGTH + 20);

    expect(readChapterWindow(chapterText, { startOffset: 10 })).toEqual({
      text: "a".repeat(CHAPTER_WINDOW_LENGTH),
      startOffset: 10,
      endOffset: CHAPTER_WINDOW_LENGTH + 10,
      totalLength: chapterText.length,
      nextOffset: CHAPTER_WINDOW_LENGTH + 10,
    });
  });

  it("returns context around the first normalized query match", () => {
    const chapterText = "prefix--first\t\tsecond--suffix";
    const matchOffset = chapterText.indexOf("first");

    expect(readChapterWindow(chapterText, { query: "first second", radius: 2 })).toEqual({
      text: "--first\t\tsecond--",
      startOffset: matchOffset - 2,
      endOffset: matchOffset + "first\t\tsecond".length + 2,
      totalLength: chapterText.length,
      matchOffset,
      nextOffset: matchOffset + "first\t\tsecond".length + 2,
    });
  });

  it("clamps an around-query window at the chapter start", () => {
    expect(readChapterWindow("match followed by text", { query: "match", radius: 10 })).toEqual({
      text: "match followed ",
      startOffset: 0,
      endOffset: 15,
      totalLength: 22,
      matchOffset: 0,
      nextOffset: 15,
    });
  });

  it("clamps an around-query window at the chapter end", () => {
    const chapterText = "text before the match";
    const matchOffset = chapterText.indexOf("match");

    expect(readChapterWindow(chapterText, { query: "match", radius: 10 })).toEqual({
      text: "efore the match",
      startOffset: matchOffset - 10,
      endOffset: chapterText.length,
      totalLength: chapterText.length,
      matchOffset,
    });
  });

  it("returns a stable error when the query is absent", () => {
    expect(readChapterWindow("chapter text", { query: "missing" })).toEqual({
      error: "query_not_found",
    });
  });

  it("caps large around-query windows at 15,000 characters", () => {
    const chapterText = `${"a".repeat(10000)}match${"b".repeat(10000)}`;
    const result = readChapterWindow(chapterText, { query: "match", radius: 10000 });

    expect(result).not.toHaveProperty("error");
    if ("error" in result) return;
    expect(result.text).toHaveLength(CHAPTER_WINDOW_LENGTH);
    expect(result.matchOffset).toBe(10000);
  });
});
