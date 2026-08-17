import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatEmptyState } from "../chat-empty-state";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("ChatEmptyState", () => {
  it("shows left-aligned questions without a headline or airplane", () => {
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    act(() => root?.render(<ChatEmptyState bookTitles={["Book"]} sendMessage={vi.fn()} />));

    const suggestion = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("What is this book about?"),
    );
    const layout = container.firstElementChild;

    expect(container.textContent).not.toContain("Discuss");
    expect(container.querySelector("svg")).toBeNull();
    expect(layout?.className).not.toContain("items-center");
    expect(layout?.className).not.toContain("justify-center");
    expect(layout?.classList.contains("px-2")).toBe(false);
    expect(suggestion?.className).toContain("text-left");
  });

  it("sends a clicked suggestion", () => {
    const container = document.body.appendChild(document.createElement("div"));
    const sendMessage = vi.fn();
    root = createRoot(container);
    act(() => root?.render(<ChatEmptyState bookTitles={["Book"]} sendMessage={sendMessage} />));

    const suggestion = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("What is this book about?"),
    );
    act(() => suggestion?.click());

    expect(sendMessage).toHaveBeenCalledWith({ text: "What is this book about?" });
  });
});
