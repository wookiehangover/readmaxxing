import React, { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "../chat-input";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function changeTextarea(textarea: HTMLTextAreaElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  setValue.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ChatInput", () => {
  it("routes focus, typing, and submit through the interaction gate", () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    const textareaRef = createRef<HTMLTextAreaElement>();
    const inputRef = { current: "" };
    const onInteraction = vi.fn();
    const onSubmit = vi.fn();

    act(() => {
      root.render(
        <ChatInput
          bookTitle="The Great Gatsby"
          textareaRef={textareaRef}
          inputRef={inputRef}
          isLoading={false}
          onSubmit={onSubmit}
          onStop={vi.fn()}
          onInteraction={onInteraction}
        />,
      );
    });

    const textarea = textareaRef.current!;
    act(() => textarea.focus());
    expect(onInteraction).toHaveBeenCalledOnce();

    act(() => changeTextarea(textarea, "Blocked message"));
    expect(inputRef.current).toBe("");
    expect(textarea.value).toBe("");

    const form = container.querySelector("form")!;
    act(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onInteraction).toHaveBeenCalledTimes(3);
    expect(onSubmit).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("preserves normal input and submit behavior without a gate", () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    const textareaRef = createRef<HTMLTextAreaElement>();
    const inputRef = { current: "" };
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());

    act(() => {
      root.render(
        <ChatInput
          bookTitle="The Great Gatsby"
          textareaRef={textareaRef}
          inputRef={inputRef}
          isLoading={false}
          onSubmit={onSubmit}
          onStop={vi.fn()}
        />,
      );
    });

    const textarea = textareaRef.current!;
    act(() => changeTextarea(textarea, "Normal message"));
    expect(inputRef.current).toBe("Normal message");

    const form = container.querySelector("form")!;
    act(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onSubmit).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });
});
