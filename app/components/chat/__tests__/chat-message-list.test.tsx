import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/components/ui/message-scroller", () => ({
  MessageScrollerProvider: ({ children }: React.PropsWithChildren) => <>{children}</>,
  MessageScroller: (props: React.ComponentProps<"div">) => <div {...props} />,
  MessageScrollerViewport: (props: React.ComponentProps<"div">) => (
    <div data-testid="viewport" {...props} />
  ),
  MessageScrollerContent: (props: React.ComponentProps<"div">) => (
    <div data-testid="content" {...props} />
  ),
  MessageScrollerItem: (props: React.ComponentProps<"div">) => <div {...props} />,
  MessageScrollerButton: () => null,
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
  it("keeps the viewport flush while content owns the right inset", () => {
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

    const viewport = container.querySelector("[data-testid='viewport']")!;
    const content = container.querySelector("[data-testid='content']")!;
    expect(viewport.classList.contains("px-4")).toBe(false);
    expect(viewport.classList.contains("pr-6")).toBe(false);
    expect(viewport.classList.contains("py-3")).toBe(true);
    expect(content.classList.contains("pr-6")).toBe(true);
    expect(content.classList.contains("pl-6")).toBe(false);
  });
});
