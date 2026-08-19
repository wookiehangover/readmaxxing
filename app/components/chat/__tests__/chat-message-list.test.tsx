import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, ...props }: React.ComponentProps<"div">) => (
    <div data-testid="scroll-area" {...props}>
      <div data-testid="viewport">{children}</div>
    </div>
  ),
}));
vi.mock("~/components/ui/marker", () => ({
  Marker: (props: React.ComponentProps<"div">) => <div {...props} />,
  MarkerContent: (props: React.ComponentProps<"div">) => <div {...props} />,
}));
vi.mock("../chat-empty-state", () => ({
  ChatEmptyState: () => <div />,
  SuggestedPrompts: () => null,
}));
vi.mock("../chat-message", () => ({ ChatMessage: () => null }));

import { ChatMessageList } from "../chat-message-list";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("ChatMessageList", () => {
  it("uses ScrollArea while content owns the mobile inset", () => {
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    act(() =>
      root?.render(
        <ChatMessageList
          messages={[]}
          status="ready"
          bookId="book-1"
          bookDataRef={createRef<ArrayBuffer>()}
          bookAnnotations={[]}
          messageIdSet={new Set()}
          selectedBookTitles={["Book"]}
          sendMessage={vi.fn()}
        />,
      ),
    );

    const scrollArea = container.querySelector("[data-testid='scroll-area']")!;
    const viewport = container.querySelector("[data-testid='viewport']")!;
    const content = viewport.firstElementChild!;
    expect(scrollArea.classList.contains("min-h-0")).toBe(true);
    expect(scrollArea.classList.contains("flex-1")).toBe(true);
    expect(scrollArea.classList.contains("pr-6")).toBe(false);
    expect(viewport.classList.contains("pr-6")).toBe(false);
    expect(content.classList.contains("pr-6")).toBe(true);
    expect(content.classList.contains("pl-6")).toBe(true);
    expect(content.classList.contains("md:pl-0")).toBe(true);
  });
});
