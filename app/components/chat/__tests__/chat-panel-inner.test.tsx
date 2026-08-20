import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    regenerate: vi.fn(),
    sendMessage: vi.fn(),
    setMessages: vi.fn(),
    status: "ready",
    stop: vi.fn(),
  }),
}));
vi.mock("~/lib/context/workspace-context", () => ({ useOptionalWorkspace: () => null }));
vi.mock("~/lib/themis/provider", () => ({
  useAppStore: () => ({
    dispatch: vi.fn(),
    chatSessionsSelectors: {
      selectActiveSessionByBook: { useValue: () => null },
    },
  }),
}));
vi.mock("~/components/chat/chat-message-list", () => ({
  ChatMessageList: () => <div data-testid="messages" />,
}));
vi.mock("~/components/chat/chat-input", () => ({
  ChatInput: () => <div data-testid="input" />,
}));
vi.mock("~/components/chat/chat-utils", () => ({
  createChatTransport: () => ({}),
  createDemoIntroChat: () => null,
}));
vi.mock("~/components/chat/use-chat-tool-handlers", () => ({
  useChatToolHandlers: () => ({ onToolCall: vi.fn(), onFinish: vi.fn() }),
}));
vi.mock("~/components/chat/use-open-books", () => ({ useOpenBooks: () => [] }));
vi.mock("~/components/chat/use-resume-message", () => ({ useResumeMessage: vi.fn() }));
vi.mock("~/components/chat/use-streaming-append", () => ({ useStreamingAppend: vi.fn() }));

import { ChatPanelInner } from "../chat-panel-inner";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("ChatPanelInner", () => {
  it("renders only the conversation without session header controls", () => {
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    act(() =>
      root?.render(
        <ChatPanelInner
          bookId="book-1"
          bookTitle="Book"
          initialMessages={[]}
          bookDataRef={createRef<ArrayBuffer>()}
          textareaRef={createRef<HTMLTextAreaElement>()}
          inputRef={{ current: "" }}
          activeSessionId="session-1"
          onSwitchSession={vi.fn()}
          onNewSession={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector("[data-testid='messages']")).not.toBeNull();
    expect(container.querySelector("[data-testid='input']")).not.toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).not.toContain("Sessions");
    expect(container.textContent).not.toContain("New chat");
  });
});
