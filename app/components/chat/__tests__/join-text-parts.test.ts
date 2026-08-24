import { describe, it, expect } from "vitest";
import {
  DEMO_CAPABILITIES_ANSWER,
  DEMO_INTRO_QUESTION,
  DEMO_SUGGESTED_QUESTIONS,
} from "~/lib/onboarding/demo-content";
import {
  createDemoIntroChat,
  joinTextParts,
  parseSuggestedPrompts,
  stripSuggestedPrompts,
} from "../chat-utils";

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

describe("demo suggested prompts", () => {
  it("parses contextual questions without displaying their metadata", () => {
    const message = `Answer text.

<!-- suggested-prompts
${DEMO_SUGGESTED_QUESTIONS.join("\n")}
-->`;

    expect(parseSuggestedPrompts(message)).toEqual(DEMO_SUGGESTED_QUESTIONS);
    expect(stripSuggestedPrompts(message)).not.toContain("suggested-prompts");
  });

  it("builds the seeded ephemeral intro from the demo content source of truth", () => {
    const chat = createDemoIntroChat();
    const initialMessages = chat.get(1);
    const intro = initialMessages[0];
    const messages = chat.get();
    const answer = messages[1].parts[0];

    expect(initialMessages).toHaveLength(1);
    expect(intro?.role).toBe("user");
    expect(intro?.parts).toEqual([{ type: "text", text: DEMO_INTRO_QUESTION }]);
    expect(answer).toMatchObject({ type: "text" });
    if (answer.type !== "text") throw new Error("Expected the intro answer to contain text");
    expect(answer.text).toContain(DEMO_CAPABILITIES_ANSWER);
    expect(DEMO_CAPABILITIES_ANSWER.match(/^- /gm)).toHaveLength(5);
    expect(DEMO_CAPABILITIES_ANSWER).toContain("Ask questions in chat");
    expect(DEMO_CAPABILITIES_ANSWER).toContain("Take notes and highlight passages");
    expect(DEMO_CAPABILITIES_ANSWER).toContain("Click a suggested question");
    expect(DEMO_CAPABILITIES_ANSWER).toContain("Sign in");
    expect(parseSuggestedPrompts(answer.text)).toEqual(DEMO_SUGGESTED_QUESTIONS);
  });
});
