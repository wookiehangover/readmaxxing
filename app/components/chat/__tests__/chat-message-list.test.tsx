import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scrollToEnd = vi.hoisted(() => vi.fn());

vi.mock("~/components/ui/message-scroller", () => ({
  MessageScrollerProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="message-scroller-provider">{children}</div>
  ),
  MessageScroller: (props: React.ComponentProps<"div">) => (
    <div data-slot="message-scroller" {...props} />
  ),
  MessageScrollerViewport: (props: React.ComponentProps<"div">) => (
    <div data-slot="message-scroller-viewport" {...props} />
  ),
  MessageScrollerContent: (props: React.ComponentProps<"div">) => (
    <div data-slot="message-scroller-content" {...props} />
  ),
  MessageScrollerItem: ({
    messageId,
    ...props
  }: React.ComponentProps<"div"> & { messageId: string }) => (
    <div data-slot="message-scroller-item" data-message-id={messageId} {...props} />
  ),
  useMessageScroller: () => ({ scrollToEnd }),
}));
vi.mock("~/components/ui/marker", () => ({
  Marker: (props: React.ComponentProps<"div">) => <div {...props} />,
  MarkerContent: (props: React.ComponentProps<"div">) => <div {...props} />,
}));
vi.mock("../chat-empty-state", () => ({
  ChatEmptyState: () => <div />,
  SuggestedPrompts: () => null,
}));
vi.mock("../chat-message", () => ({
  ChatMessage: ({ message }: { message: { role: string } }) => (
    <div data-testid={`message-${message.role}`}>{message.role}</div>
  ),
}));

import { ChatMessageList } from "../chat-message-list";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

beforeEach(() => {
  scrollToEnd.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("ChatMessageList", () => {
  it("composes MessageScroller while content owns the mobile inset", () => {
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

    const scroller = container.querySelector("[data-slot='message-scroller']")!;
    const viewport = container.querySelector("[data-slot='message-scroller-viewport']")!;
    const content = container.querySelector("[data-slot='message-scroller-content']")!;
    expect(scroller.classList.contains("min-h-0")).toBe(true);
    expect(scroller.classList.contains("flex-1")).toBe(true);
    expect(scroller.classList.contains("pr-6")).toBe(false);
    expect(viewport.classList.contains("pr-6")).toBe(false);
    expect(content.classList.contains("pr-6")).toBe(true);
    expect(content.classList.contains("pl-6")).toBe(true);
    expect(content.classList.contains("md:pl-0")).toBe(true);
  });

  it("uses stable message ids for scroller items and restores the end when shown", () => {
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    const props = {
      messages: [
        { id: "message-1", role: "user" as const, parts: [{ type: "text" as const, text: "One" }] },
        {
          id: "message-2",
          role: "assistant" as const,
          parts: [{ type: "text" as const, text: "Two" }],
        },
      ],
      status: "ready",
      bookId: "book-1",
      bookDataRef: createRef<ArrayBuffer>(),
      bookAnnotations: [],
      messageIdSet: new Set(["message-1", "message-2"]),
      selectedBookTitles: ["Book"],
      sendMessage: vi.fn(),
      isVisible: false,
    };

    act(() => root?.render(<ChatMessageList {...props} />));
    expect(
      Array.from(container.querySelectorAll("[data-slot='message-scroller-item']"), (item) =>
        item.getAttribute("data-message-id"),
      ),
    ).toEqual(["message-1", "message-2"]);
    expect(scrollToEnd).not.toHaveBeenCalled();

    act(() => root?.render(<ChatMessageList {...props} isVisible />));
    expect(scrollToEnd).toHaveBeenCalledWith({ behavior: "auto" });
  });

  it("shows preparation status without replacing the user message", () => {
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    act(() =>
      root?.render(
        <ChatMessageList
          messages={[
            {
              id: "message-1",
              role: "user",
              parts: [{ type: "text", text: "Hello" }],
            },
          ]}
          status="submitted"
          bookId="book-1"
          bookDataRef={createRef<ArrayBuffer>()}
          bookAnnotations={[]}
          messageIdSet={new Set(["message-1"])}
          selectedBookTitles={["Book"]}
          sendMessage={vi.fn()}
          isPreparingForChat
        />,
      ),
    );

    expect(container.querySelector("[data-testid='message-user']")).not.toBeNull();
    expect(container.querySelector("[role='status']")?.textContent).toBe(
      "Preparing this book for chat…",
    );
  });
});
