import { describe, it, expect } from "vitest";
import { joinTextParts } from "../chat-utils";

describe("joinTextParts", () => {
  it("returns an empty string for no parts", () => {
    expect(joinTextParts([])).toBe("");
  });

  it("returns a single part unchanged", () => {
    expect(joinTextParts(["Hello world."])).toBe("Hello world.");
  });

  it("restores a space at a boundary where neither side has whitespace", () => {
    // The bug: a sentence boundary fell exactly at a part split, so the
    // whitespace separator was lost when the parts were joined.
    expect(joinTextParts(["end of chunk.", "Next sentence"])).toBe("end of chunk. Next sentence");
  });

  it("does not add a space when the previous part already ends with whitespace", () => {
    expect(joinTextParts(["end of chunk. ", "Next sentence"])).toBe("end of chunk. Next sentence");
  });

  it("does not add a space when the next part already begins with whitespace", () => {
    expect(joinTextParts(["end of chunk.", " Next sentence"])).toBe("end of chunk. Next sentence");
  });

  it("preserves a newline boundary without inserting a space", () => {
    expect(joinTextParts(["paragraph one\n\n", "paragraph two"])).toBe(
      "paragraph one\n\nparagraph two",
    );
  });

  it("ignores empty parts without inserting spurious spaces", () => {
    expect(joinTextParts(["Hello", "", "world"])).toBe("Hello world");
    expect(joinTextParts(["", "Hello"])).toBe("Hello");
  });
});
