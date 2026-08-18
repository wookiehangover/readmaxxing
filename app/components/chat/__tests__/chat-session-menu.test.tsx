import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const runPromise = vi.hoisted(() => vi.fn());

vi.mock("~/lib/effect-runtime", () => ({ AppRuntime: { runPromise } }));
vi.mock("~/components/ui/dropdown-menu", () => ({
  DropdownMenuGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick, disabled }: React.ComponentProps<"button">) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

import { ChatRecentSessionsMenu } from "../chat-session-menu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  runPromise.mockReset();
  document.body.innerHTML = "";
});

describe("ChatRecentSessionsMenu", () => {
  it("sorts recent sessions and switches conversations", async () => {
    runPromise.mockResolvedValue([
      {
        id: "session-1",
        bookId: "book-1",
        title: "Older chat",
        messages: [],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "session-2",
        bookId: "book-1",
        title: "Newer chat",
        messages: [],
        createdAt: 2,
        updatedAt: 2,
      },
    ]);
    const onSwitchSession = vi.fn();
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);

    await act(async () =>
      root?.render(
        <ChatRecentSessionsMenu
          bookId="book-1"
          activeSessionId="session-1"
          onSwitchSession={onSwitchSession}
          onNewSession={vi.fn()}
        />,
      ),
    );

    const sessionButtons = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.title !== "Delete session",
    );
    expect(sessionButtons[0]?.textContent).toContain("Newer chat");
    act(() => sessionButtons[0]?.click());
    expect(onSwitchSession).toHaveBeenCalledWith("session-2");
  });
});
