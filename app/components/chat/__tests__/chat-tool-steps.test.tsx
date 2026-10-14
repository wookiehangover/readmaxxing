import React, { act } from "react";
import type { UIMessage } from "@ai-sdk/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolStepsDetails } from "../chat-tool-steps";
import { buildChatTrace, summarizeChatTrace } from "../chat-trace-model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const resolveBookTitle = (id?: string) => (id === "walden" ? "Walden" : "Essays");
const search = {
  type: "tool-search_book" as const,
  toolCallId: "search-1",
  state: "output-available" as const,
  input: { query: "solitude", bookId: "walden" },
  output: {
    bookId: "walden",
    results: [{ chapterTitle: "Solitude", excerpt: "I love to be alone." }],
  },
};

describe("chat trace state mapping", () => {
  it("keeps reasoning and tools in message order and omits answer text", () => {
    const steps = buildChatTrace(
      [
        { type: "reasoning", state: "done", text: "Find a passage." },
        search,
        { type: "reasoning", state: "streaming", text: "Compare the result." },
        { type: "text", text: "The answer." },
      ],
      true,
      resolveBookTitle,
      true,
    );
    expect(steps.map((step) => step.toolName)).toEqual(["reasoning", "search_book", "reasoning"]);
    expect(steps.map((step) => step.status)).toEqual([undefined, undefined, "running"]);
    expect(summarizeChatTrace(steps)).toBe("Thinking");
  });

  it("resolves the selected book before output arrives, then counts repeated searches", () => {
    const [running] = buildChatTrace(
      [{ ...search, state: "input-available", output: undefined }],
      true,
      resolveBookTitle,
      true,
    );
    expect(running.title).toContain("Searching Walden");
    expect(running.status).toBe("running");
    const steps = buildChatTrace(
      [search, { ...search, toolCallId: "search-2" }],
      false,
      resolveBookTitle,
      true,
    );
    expect(summarizeChatTrace(steps)).toBe("Searched Walden (2×)");
  });

  it("supports both saved search output shapes, including empty results", () => {
    const steps = buildChatTrace(
      [
        { ...search, output: search.output.results },
        { ...search, toolCallId: "search-2", output: { results: [] } },
      ],
      false,
      resolveBookTitle,
      false,
    );
    expect(steps[0].results).toEqual(search.output.results);
    expect(steps[0].description).toBe("1 result");
    expect(steps[1].description).toBe("0 results");
    expect(steps[1].status).toBeUndefined();
  });

  it.each([
    {
      type: "tool-edit_notes",
      state: "output-available",
      output: { executed: false, error: "Conflict" },
    },
    {
      type: "tool-append_to_notes",
      state: "output-available",
      output: { appended: false, error: "Conflict" },
    },
    {
      type: "tool-attach_highlight",
      state: "output-available",
      output: { attached: false, reason: "Conflict" },
    },
    { type: "dynamic-tool", toolName: "edit_notes", state: "output-error", errorText: "Conflict" },
  ])("shows a failure for $type / $state", (part) => {
    const [step] = buildChatTrace(
      [{ ...part, toolCallId: "failed", input: {} }] as UIMessage["parts"],
      true,
      resolveBookTitle,
      false,
    );
    expect(step.status).toBe("error");
    expect(step.text).toBe("Conflict");
    expect(step.title).toMatch(/^Failed to /);
    expect(summarizeChatTrace([step])).toMatch(/^Failed to /);
  });

  it("does not animate stopped or denied work as running", () => {
    const parts = [{ ...search, state: "input-available" as const, output: undefined }];
    const [stopped] = buildChatTrace(parts, false, resolveBookTitle, false);
    expect(stopped.title).toMatch(/^Stopped:/);
    expect(stopped.status).toBe("error");
    const [denied] = buildChatTrace(
      [
        {
          type: "dynamic-tool",
          toolName: "edit_notes",
          toolCallId: "denied",
          state: "output-denied",
          input: {},
          approval: { id: "approval", approved: false },
        },
      ],
      true,
      resolveBookTitle,
      false,
    );
    expect(denied.title).toBe("Skipped: edit notebook");
    expect(denied.status).toBeUndefined();
  });

  it("puts a failure in the summary even after completed tools", () => {
    const steps = buildChatTrace(
      [
        search,
        {
          type: "tool-edit_notes",
          toolCallId: "failed",
          state: "output-error",
          input: {},
          errorText: "Conflict",
        },
      ],
      false,
      resolveBookTitle,
      true,
    );
    expect(summarizeChatTrace(steps)).toBe("Failed to edit notebook");
  });

  it("uses the returned chapter location and only enables successful book actions", () => {
    const steps = buildChatTrace(
      [
        {
          type: "tool-read_chapter",
          toolCallId: "read",
          state: "output-available",
          input: { chapterIndex: 3 },
          output: { title: "Solitude", chapterIndex: 5, bookId: "walden" },
        },
        {
          type: "tool-create_highlight",
          toolCallId: "highlight",
          state: "output-error",
          input: { text: "alone" },
          errorText: "Failed",
        },
      ],
      false,
      resolveBookTitle,
      true,
    );
    expect(steps[0]).toMatchObject({
      title: "Read Solitude",
      chapterIndex: 5,
      bookId: "walden",
      canOpen: true,
    });
    expect(steps[1].canOpen).toBe(false);
  });
});

describe("ToolStepsDetails disclosure", () => {
  async function render(parts: UIMessage["parts"], isStreaming: boolean) {
    if (!root) root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () =>
      root?.render(
        <ToolStepsDetails
          parts={parts}
          isStreaming={isStreaming}
          resolveBookTitle={resolveBookTitle}
          showBookLabel
        />,
      ),
    );
    return document.querySelector<HTMLButtonElement>("button")!;
  }

  it("opens during activity and closes on completion unless the reader chose otherwise", async () => {
    const active = { ...search, state: "input-available" as const, output: undefined };
    let trigger = await render([active], true);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    trigger = await render([search], false);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await act(async () => trigger.click());
    trigger = await render([active], true);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    trigger = await render([search], false);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps a manual collapse when another streaming update arrives", async () => {
    const active = { ...search, state: "input-available" as const, output: undefined };
    let trigger = await render([active], true);
    await act(async () => trigger.click());
    trigger = await render(
      [active, { type: "reasoning", state: "streaming", text: "More context." }],
      true,
    );
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens search passages in the current book but not another book", async () => {
    const onOpen = vi.fn();
    root = createRoot(document.body.appendChild(document.createElement("div")));
    async function show(bookId: string) {
      await act(async () =>
        root?.render(
          <ToolStepsDetails
            parts={[search]}
            resolveBookTitle={resolveBookTitle}
            showBookLabel
            bookId={bookId}
            onOpen={onOpen}
          />,
        ),
      );
    }
    await show("walden");
    const passage = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("I love to be alone."),
    )!;
    expect(passage).toBeDefined();
    await act(async () => passage.click());
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: "walden" }),
      search.output.results[0],
    );
    await show("essays");
    expect(
      Array.from(document.querySelectorAll("button")).some((button) =>
        button.textContent?.includes("I love to be alone."),
      ),
    ).toBe(false);
  });
});
