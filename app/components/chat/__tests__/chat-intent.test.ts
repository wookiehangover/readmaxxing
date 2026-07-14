import { describe, expect, it } from "vitest";
import { resolvePendingChatMessage } from "../chat-intent";

describe("resolvePendingChatMessage", () => {
  it("resumes trimmed text typed into the chat input", () => {
    expect(resolvePendingChatMessage({ type: "typed", text: "  Ask about Gatsby  " })).toBe(
      "Ask about Gatsby",
    );
  });

  it("resumes a clicked suggested question", () => {
    expect(resolvePendingChatMessage({ type: "suggested", text: "Why does Nick say this?" })).toBe(
      "Why does Nick say this?",
    );
  });

  it("does not synthesize a message for passive interaction", () => {
    expect(resolvePendingChatMessage({ type: "none" })).toBeNull();
  });
});
