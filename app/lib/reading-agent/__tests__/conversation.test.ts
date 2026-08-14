import { describe, expect, it } from "vitest";
import { sanitizeConversationMessages } from "../conversation";

describe("sanitizeConversationMessages", () => {
  it("keeps assistant reasoning, reply text, and tool names", () => {
    expect(
      sanitizeConversationMessages([
        {
          id: "assistant-1",
          role: "assistant",
          purpose: "assistant",
          display: "visible",
          parts: [
            { type: "reasoning", text: "The chapter introduces two characters.", state: "done" },
            {
              type: "dynamic-tool",
              toolName: "readWiki",
              toolCallId: "call-1",
              state: "output-available",
              input: { locator: "chapter-14.xhtml" },
              output: { text: "secret page body" },
            },
            { type: "text", text: "Updated the wiki with the new scene.", state: "streaming" },
          ],
        },
      ]),
    ).toEqual([
      {
        id: "assistant-1",
        role: "assistant",
        purpose: "assistant",
        display: "visible",
        parts: [
          { type: "reasoning", text: "The chapter introduces two characters.", state: "done" },
          { type: "dynamic-tool", toolName: "readWiki", state: "output-available" },
          { type: "text", text: "Updated the wiki with the new scene.", state: "streaming" },
        ],
      },
    ]);
  });

  it("redacts ingest page text and drops data and file payloads", () => {
    expect(
      sanitizeConversationMessages([
        {
          id: "user-1",
          role: "user",
          purpose: "user",
          display: "visible",
          parts: [{ type: "text", text: "Chapter 14 page body", state: "done" }],
        },
        {
          id: "assistant-2",
          role: "assistant",
          purpose: "assistant",
          display: "visible",
          parts: [
            { type: "data-page", data: { text: "Chapter 14 page body" } },
            {
              type: "file",
              mediaType: "text/plain",
              url: "data:text/plain,Chapter%2014",
              filename: "page.txt",
            },
            {
              type: "dynamic-tool",
              toolName: "writeWiki",
              state: "output-error",
              errorText: "timeout",
            },
          ],
        },
      ]),
    ).toEqual([
      { id: "user-1", role: "user", purpose: "user", display: "visible", parts: [] },
      {
        id: "assistant-2",
        role: "assistant",
        purpose: "assistant",
        display: "visible",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "writeWiki",
            state: "output-error",
            errorText: "timeout",
          },
        ],
      },
    ]);
  });
});
