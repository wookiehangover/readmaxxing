import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { clear } from "idb-keyval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadChapterQuestions } from "~/lib/chat/chapter-questions";
import { getChapterQuestionsStore } from "~/lib/sync/stores";
import { ChatEmptyState, SuggestedPrompts } from "../chat-empty-state";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const GENERATED = ["Generated one?", "Generated two?", "Generated three?"];

beforeEach(async () => {
  await clear(getChapterQuestionsStore());
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function renderEmptyState(sendMessage = vi.fn(), chapterIndex = 2) {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      <ChatEmptyState
        bookId="book-1"
        bookTitles={["Book"]}
        chapterIndex={chapterIndex}
        sendMessage={sendMessage}
      />,
    ),
  );
  return container;
}

async function waitForText(container: HTMLElement, text: string) {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain(text);
  });
}

describe("ChatEmptyState", () => {
  it("shows the Dig deeper heading with left-aligned loading skeletons", async () => {
    vi.spyOn(window, "fetch").mockImplementation(() => new Promise<Response>(() => {}));
    const container = renderEmptyState();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const suggestion = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("What is this book about?"),
    );
    const layout = container.firstElementChild;
    const questions = layout?.firstElementChild;

    expect(container.textContent).not.toContain("Discuss");
    expect(container.querySelector("svg")).toBeNull();
    expect(layout?.className).not.toContain("items-center");
    expect(layout?.className).not.toContain("justify-center");
    expect(layout?.classList.contains("px-2")).toBe(false);
    expect(questions?.classList.contains("max-w-sm")).toBe(false);
    expect(suggestion?.className).toContain("text-left");
    const digDeeperHeading = Array.from(container.querySelectorAll("span")).find(
      (span) => span.textContent === "Dig deeper",
    );
    expect(digDeeperHeading?.className).toBe("text-xs tracking-wide text-muted-foreground");
    expect(container.textContent).not.toContain("Pull the Thread");
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
  });

  it("shows generated chapter questions", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(Response.json(GENERATED));
    const container = renderEmptyState();

    await waitForText(container, GENERATED[0]);
    expect(GENERATED.every((question) => container.textContent?.includes(question))).toBe(true);
    expect(container.textContent).toContain("Dig deeper");
    expect(container.textContent).not.toContain("Pull the Thread");
  });

  it("shows the static questions when the request fails", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    const container = renderEmptyState();

    await waitForText(container, "What ideas connect across multiple chapters?");
    expect(container.textContent).toContain("Dig deeper");
    expect(container.textContent).not.toContain("Pull the Thread");
  });

  it("shows the static questions for an invalid payload", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(Response.json(["Only one"]));
    const container = renderEmptyState();

    await waitForText(container, "What else should I read after this?");
  });

  it("uses a cached chapter without refetching", async () => {
    const fetchMock = vi.spyOn(window, "fetch").mockResolvedValue(Response.json(GENERATED));
    await loadChapterQuestions("book-1", 2);
    fetchMock.mockClear();

    const container = renderEmptyState();
    await waitForText(container, GENERATED[0]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches questions for a changed chapter", async () => {
    const next = ["Next one?", "Next two?", "Next three?"];
    const fetchMock = vi
      .spyOn(window, "fetch")
      .mockResolvedValueOnce(Response.json(GENERATED))
      .mockResolvedValueOnce(Response.json(next));
    const container = renderEmptyState();
    await waitForText(container, GENERATED[0]);

    act(() =>
      root?.render(
        <ChatEmptyState
          bookId="book-1"
          bookTitles={["Book"]}
          chapterIndex={3}
          sendMessage={vi.fn()}
        />,
      ),
    );
    await waitForText(container, next[0]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not inset suggested follow-up prompts", () => {
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    act(() => root?.render(<SuggestedPrompts prompts={["What follows?"]} sendMessage={vi.fn()} />));

    expect(container.firstElementChild?.classList.contains("px-5")).toBe(false);
  });

  it("sends a clicked suggestion", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(Response.json(GENERATED));
    const sendMessage = vi.fn();
    const container = renderEmptyState(sendMessage);
    await waitForText(container, GENERATED[0]);

    const suggestion = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes(GENERATED[0]),
    );
    act(() => suggestion?.click());

    expect(sendMessage).toHaveBeenCalledWith({ text: GENERATED[0] });
  });
});
