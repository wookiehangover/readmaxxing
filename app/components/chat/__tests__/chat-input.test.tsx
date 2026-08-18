import React, { act, createRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnboardingDialog } from "~/components/onboarding/onboarding-dialog";
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

function GatedChatInputWithDialog({
  textareaRef,
  onInteraction,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onInteraction: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ChatInput
        textareaRef={textareaRef}
        inputRef={{ current: "" }}
        isLoading={false}
        onSubmit={vi.fn()}
        onStop={vi.fn()}
        onInteraction={() => {
          onInteraction();
          setOpen(true);
        }}
      />
      <OnboardingDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

describe("ChatInput", () => {
  it("keeps the onboarding dialog open after a pointer click", () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    const textareaRef = createRef<HTMLTextAreaElement>();
    const onInteraction = vi.fn();

    act(() => {
      root.render(
        <MemoryRouter>
          <GatedChatInputWithDialog textareaRef={textareaRef} onInteraction={onInteraction} />
        </MemoryRouter>,
      );
    });

    const textarea = textareaRef.current!;
    const pointerDown = new Event("pointerdown", { bubbles: true, cancelable: true });
    act(() => textarea.dispatchEvent(pointerDown));
    expect(pointerDown.defaultPrevented).toBe(true);
    expect(onInteraction).not.toHaveBeenCalled();
    if (!pointerDown.defaultPrevented) act(() => textarea.focus());
    act(() => textarea.dispatchEvent(new Event("pointerup", { bubbles: true })));
    act(() => textarea.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(onInteraction).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    act(() => root.unmount());
  });

  it("passively gates focus once, allows typing, and captures the value on submit", () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    const textareaRef = createRef<HTMLTextAreaElement>();
    const inputRef = { current: "" };
    const onInteraction = vi.fn();
    const onSubmit = vi.fn();

    act(() => {
      root.render(
        <ChatInput
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
    expect(onInteraction).toHaveBeenLastCalledWith({ type: "none" });

    act(() => changeTextarea(textarea, "Typed message"));
    expect(inputRef.current).toBe("Typed message");
    expect(textarea.value).toBe("Typed message");
    expect(onInteraction).toHaveBeenCalledOnce();

    act(() => textarea.focus());
    expect(onInteraction).toHaveBeenCalledOnce();

    const form = container.querySelector("form")!;
    act(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onInteraction).toHaveBeenCalledTimes(2);
    expect(onInteraction).toHaveBeenLastCalledWith({ type: "typed", text: "Typed message" });
    expect(onSubmit).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("does not preventDefault or blur on keystrokes when gated", () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    const textareaRef = createRef<HTMLTextAreaElement>();
    const inputRef = { current: "" };
    const onInteraction = vi.fn();

    act(() => {
      root.render(
        <ChatInput
          textareaRef={textareaRef}
          inputRef={inputRef}
          isLoading={false}
          onSubmit={vi.fn()}
          onStop={vi.fn()}
          onInteraction={onInteraction}
        />,
      );
    });

    const textarea = textareaRef.current!;
    act(() => textarea.focus());
    expect(document.activeElement).toBe(textarea);

    const keyEvent = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    act(() => textarea.dispatchEvent(keyEvent));
    expect(keyEvent.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(textarea);
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
          textareaRef={textareaRef}
          inputRef={inputRef}
          isLoading={false}
          onSubmit={onSubmit}
          onStop={vi.fn()}
        />,
      );
    });

    const textarea = textareaRef.current!;
    expect(textarea.placeholder).toBe("Ask about this book...");
    const form = container.querySelector("form")!;
    expect(form.classList.contains("px-4")).toBe(false);
    expect(form.classList.contains("py-3")).toBe(true);
    expect(form.classList.contains("pr-6")).toBe(true);
    expect(form.classList.contains("pl-6")).toBe(false);
    act(() => changeTextarea(textarea, "Normal message"));
    expect(inputRef.current).toBe("Normal message");

    act(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onSubmit).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });
});
