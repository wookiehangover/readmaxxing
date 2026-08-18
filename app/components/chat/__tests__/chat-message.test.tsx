import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { UIMessage } from "@ai-sdk/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatMessage } from "../chat-message";

vi.mock("~/lib/context/workspace-context", () => ({
  useWorkspace: () => ({
    navigateInCluster: vi.fn(),
    findTocForBook: vi.fn(),
    applyTempHighlightForBook: vi.fn(),
    booksRef: { current: [] },
  }),
}));

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("ChatMessage Streamdown headings", () => {
  it("renders semantic headings at the Quiet editorial scale", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    const message: UIMessage = {
      id: "message-1",
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6",
        },
      ],
    };
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ChatMessage message={message} bookId="book-1" bookDataRef={createRef<ArrayBuffer>()} />,
      );
    });

    const expectedSizes = [
      "text-[1.125em]",
      "text-[1em]",
      "text-[0.9375em]",
      "text-[0.875em]",
      "text-[0.875em]",
      "text-[0.8125em]",
    ];
    const streamdownDefaults = [
      "text-3xl",
      "text-2xl",
      "text-xl",
      "text-lg",
      "text-base",
      "text-sm",
    ];

    expectedSizes.forEach((size, index) => {
      const level = index + 1;
      const heading = container.querySelector(`h${level}`);
      expect(heading?.tagName).toBe(`H${level}`);
      expect(heading?.classList.contains(size)).toBe(true);
      expect(heading?.getAttribute("data-streamdown")).toBe(`heading-${level}`);
      expect(heading?.classList.contains(streamdownDefaults[index])).toBe(false);
      expect(heading?.classList.contains("font-semibold")).toBe(false);
    });

    expect(container.querySelector("h1")?.classList.contains("font-medium")).toBe(true);
    expect(container.querySelector("h2")?.classList.contains("font-medium")).toBe(true);
  });
});
