import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NotebookEditorCallbacks } from "~/lib/context/workspace-context";
import type { JSONContent } from "@tiptap/react";
import type { UIMessage } from "@ai-sdk/react";

// Mock useWorkspace to return controllable refs
const mockNotebookEditorCallbackMap = { current: new Map<string, NotebookEditorCallbacks>() };
const mockNotebookContentChangeMap = {
  current: new Map<string, (markdown: string) => void>(),
};
const mockNotebookCallbackMap = {
  current: new Map<
    string,
    (attrs: { highlightId: string; cfiRange: string; text: string }) => void
  >(),
};

vi.mock("~/lib/context/workspace-context", () => ({
  useWorkspace: () => ({
    waitForNavForBook: vi.fn(),
    applyTempHighlightForBook: vi.fn(),
    notebookCallbackMap: mockNotebookCallbackMap,
    notebookEditorCallbackMap: mockNotebookEditorCallbackMap,
    notebookContentChangeMap: mockNotebookContentChangeMap,
  }),
}));

const serviceMocks = vi.hoisted(() => ({
  cacheNotebook: vi.fn().mockResolvedValue(undefined),
  saveHighlight: vi.fn().mockResolvedValue(undefined),
  getBookData: vi.fn(),
}));
const storeMocks = vi.hoisted(() => ({ dispatch: vi.fn() }));

vi.mock("~/lib/stores/annotations-store", () => ({
  AnnotationService: serviceMocks,
}));
vi.mock("~/lib/stores/book-store", () => ({
  BookService: { getBookData: serviceMocks.getBookData },
}));
vi.mock("~/lib/themis/provider", () => ({
  useAppStore: () => ({ dispatch: storeMocks.dispatch }),
}));

const fuzzySearchEpubForCfi = vi.fn();
vi.mock("~/lib/epub/epub-search", () => ({ fuzzySearchEpubForCfi }));

// Must import AFTER mocks are set up
const { useChatToolHandlers } = await import("../use-chat-tool-handlers");
import { renderHookSimple } from "./render-hook-simple";

function makeAppendOutputMessage(
  toolCallId: string,
  text: string,
  appendedNodes: JSONContent[],
  extras?: { updatedContent?: JSONContent; updatedAt?: number; bookId?: string },
): UIMessage {
  return {
    id: "msg-1",
    role: "assistant",
    parts: [
      {
        // AI SDK encodes static tool calls as `tool-<name>`.
        type: "tool-append_to_notes",
        toolCallId,
        state: "output-available",
        input: { text },
        output: {
          appended: true,
          text,
          appendedNodes,
          ...(extras?.bookId !== undefined ? { bookId: extras.bookId } : {}),
          ...(extras?.updatedContent !== undefined
            ? { updatedContent: extras.updatedContent }
            : {}),
          ...(extras?.updatedAt !== undefined ? { updatedAt: extras.updatedAt } : {}),
        },
      } as unknown as UIMessage["parts"][number],
    ],
  };
}

function makeEditorCallbacks(
  overrides: Partial<import("~/lib/context/workspace-context").NotebookEditorCallbacks> = {},
) {
  return {
    appendContent: vi.fn(),
    setContent: vi.fn(),
    getContent: vi.fn().mockReturnValue({ type: "doc", content: [] }),
    getTopLevelNodeCount: vi.fn().mockReturnValue(0),
    replaceContentFrom: vi.fn(),
    seedLastContent: vi.fn(),
    ...overrides,
  };
}

function waitForMicrotasks() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  storeMocks.dispatch.mockReset();
  storeMocks.dispatch.mockImplementation((action) => {
    const [record, onCompleted, onFailed] = action.payload;
    const persist =
      action.type === "annotations/cacheNotebookRequested"
        ? serviceMocks.cacheNotebook(record)
        : action.type === "annotations/addHighlightRequested"
          ? serviceMocks.saveHighlight(record)
          : Promise.resolve();
    void persist.then(() => onCompleted?.(record), onFailed);
    return action;
  });
});

describe("useChatToolHandlers – append_to_notes (server-authoritative)", () => {
  let streamedToolCallIdRef: { current: Map<string, JSONContent> };
  let appendContentSpy: ReturnType<typeof vi.fn<(nodes: JSONContent[]) => void>>;

  beforeEach(() => {
    streamedToolCallIdRef = { current: new Map<string, JSONContent>() };
    appendContentSpy = vi.fn();
    mockNotebookEditorCallbackMap.current.clear();
    mockNotebookContentChangeMap.current.clear();
    serviceMocks.cacheNotebook.mockClear();
    serviceMocks.cacheNotebook.mockResolvedValue(undefined);
    serviceMocks.saveHighlight.mockClear();
  });

  function getOnFinish() {
    const { onFinish } = renderHookSimple(() =>
      useChatToolHandlers({
        bookId: "book-1",
        bookDataRef: { current: null },
        streamedToolCallIdRef,
      }),
    );
    return onFinish;
  }

  it("applies appendedNodes to the live editor", () => {
    mockNotebookEditorCallbackMap.current.set(
      "book-1",
      makeEditorCallbacks({ appendContent: appendContentSpy }),
    );

    const appendedNodes: JSONContent[] = [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Hello" }] },
    ];
    const onFinish = getOnFinish();
    onFinish({ message: makeAppendOutputMessage("tc-1", "# Hello", appendedNodes) });

    expect(appendContentSpy).toHaveBeenCalledTimes(1);
    expect(appendContentSpy).toHaveBeenCalledWith(appendedNodes);
  });

  it("routes appendedNodes to the book named in the tool output (multi-book)", () => {
    const primarySpy = vi.fn();
    const secondarySpy = vi.fn();
    mockNotebookEditorCallbackMap.current.set(
      "book-1",
      makeEditorCallbacks({ appendContent: primarySpy }),
    );
    mockNotebookEditorCallbackMap.current.set(
      "book-2",
      makeEditorCallbacks({ appendContent: secondarySpy }),
    );

    const appendedNodes: JSONContent[] = [
      { type: "paragraph", content: [{ type: "text", text: "for book 2" }] },
    ];
    const onFinish = getOnFinish();
    onFinish({
      message: makeAppendOutputMessage("tc-1", "for book 2", appendedNodes, { bookId: "book-2" }),
    });

    // Routed to the secondary book's editor, not the bound primary.
    expect(secondarySpy).toHaveBeenCalledWith(appendedNodes);
    expect(primarySpy).not.toHaveBeenCalled();
  });

  it("skips appendContent when the streaming preview already inserted the nodes", () => {
    mockNotebookEditorCallbackMap.current.set(
      "book-1",
      makeEditorCallbacks({ appendContent: appendContentSpy }),
    );

    streamedToolCallIdRef.current.set("tc-1", { type: "doc", content: [] });

    const appendedNodes: JSONContent[] = [
      { type: "paragraph", content: [{ type: "text", text: "noted" }] },
    ];
    const onFinish = getOnFinish();
    onFinish({ message: makeAppendOutputMessage("tc-1", "noted", appendedNodes) });

    expect(appendContentSpy).not.toHaveBeenCalled();
    // Entry is consumed so the set doesn't grow across messages.
    expect(streamedToolCallIdRef.current.has("tc-1")).toBe(false);
  });

  it("is a no-op when the editor is NOT open (notebook row arrives via sync pull)", () => {
    const appendedNodes: JSONContent[] = [
      { type: "paragraph", content: [{ type: "text", text: "jot" }] },
    ];
    const onFinish = getOnFinish();
    // No editor registered in notebookEditorCallbackMap.
    expect(() =>
      onFinish({ message: makeAppendOutputMessage("tc-1", "jot", appendedNodes) }),
    ).not.toThrow();
    expect(appendContentSpy).not.toHaveBeenCalled();
  });

  it("does nothing when server reports appended=false", () => {
    mockNotebookEditorCallbackMap.current.set(
      "book-1",
      makeEditorCallbacks({ appendContent: appendContentSpy }),
    );

    const msg: UIMessage = {
      id: "msg-1",
      role: "assistant",
      parts: [
        {
          type: "tool-append_to_notes",
          toolCallId: "tc-1",
          state: "output-available",
          input: { text: "x" },
          output: { appended: false, text: "x", appendedNodes: [] },
        } as unknown as UIMessage["parts"][number],
      ],
    };

    const onFinish = getOnFinish();
    onFinish({ message: msg });

    expect(appendContentSpy).not.toHaveBeenCalled();
    expect(serviceMocks.cacheNotebook).not.toHaveBeenCalled();
  });

  it("restores pre-preview content when a streamed append fails without a server snapshot", () => {
    const setContentSpy = vi.fn();
    mockNotebookEditorCallbackMap.current.set(
      "book-1",
      makeEditorCallbacks({ setContent: setContentSpy }),
    );
    const originalContent: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "original" }] }],
    };
    streamedToolCallIdRef.current.set("tc-failed", originalContent);

    const msg: UIMessage = {
      id: "msg-failed",
      role: "assistant",
      parts: [
        {
          type: "tool-append_to_notes",
          toolCallId: "tc-failed",
          state: "output-available",
          input: { text: "optimistic preview" },
          output: { appended: false, text: "optimistic preview", appendedNodes: [] },
        } as unknown as UIMessage["parts"][number],
      ],
    };

    const onFinish = getOnFinish();
    onFinish({ message: msg });

    expect(setContentSpy).toHaveBeenCalledWith(originalContent);
    expect(streamedToolCallIdRef.current.has("tc-failed")).toBe(false);
    expect(serviceMocks.cacheNotebook).not.toHaveBeenCalled();
  });

  it("restores and caches the authoritative notebook when a streamed append loses an LWW race", async () => {
    const setContentSpy = vi.fn();
    const seedSpy = vi.fn();
    mockNotebookEditorCallbackMap.current.set(
      "book-1",
      makeEditorCallbacks({ setContent: setContentSpy, seedLastContent: seedSpy }),
    );
    streamedToolCallIdRef.current.set("tc-conflict", { type: "doc", content: [] });

    const authoritativeContent: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "newer remote note" }] }],
    };
    const authoritativeUpdatedAt = 1_700_000_999_000;
    const msg: UIMessage = {
      id: "msg-conflict",
      role: "assistant",
      parts: [
        {
          type: "tool-append_to_notes",
          toolCallId: "tc-conflict",
          state: "output-available",
          input: { text: "optimistic preview" },
          output: {
            bookId: "book-1",
            appended: false,
            text: "optimistic preview",
            appendedNodes: [],
            updatedContent: authoritativeContent,
            updatedAt: authoritativeUpdatedAt,
            error: "append_to_notes: server already has a newer notebook; ignoring this edit",
          },
        } as unknown as UIMessage["parts"][number],
      ],
    };

    const events: CustomEvent[] = [];
    const listener = (event: Event) => events.push(event as CustomEvent);
    window.addEventListener("sync:entity-updated", listener);

    try {
      const onFinish = getOnFinish();
      onFinish({ message: msg });

      expect(streamedToolCallIdRef.current.has("tc-conflict")).toBe(false);
      expect(setContentSpy).toHaveBeenCalledWith(authoritativeContent);
      expect(seedSpy).toHaveBeenCalledWith(authoritativeContent);
      expect(serviceMocks.cacheNotebook).toHaveBeenCalledTimes(1);

      await waitForMicrotasks();
      expect(events).toHaveLength(1);
      expect(events[0].detail).toEqual({ entity: "notebook" });
    } finally {
      window.removeEventListener("sync:entity-updated", listener);
    }
  });

  it("caches updatedContent to IDB and dispatches sync:entity-updated for notebook", async () => {
    const seedSpy = vi.fn();
    mockNotebookEditorCallbackMap.current.set(
      "book-1",
      makeEditorCallbacks({ appendContent: appendContentSpy, seedLastContent: seedSpy }),
    );

    const appendedNodes: JSONContent[] = [
      { type: "paragraph", content: [{ type: "text", text: "hello from chat" }] },
    ];
    const updatedContent: JSONContent = {
      type: "doc",
      content: appendedNodes,
    };
    const updatedAt = 1_700_000_000_000;

    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener("sync:entity-updated", listener);

    try {
      const onFinish = getOnFinish();
      onFinish({
        message: makeAppendOutputMessage("tc-1", "hello from chat", appendedNodes, {
          updatedContent,
          updatedAt,
        }),
      });

      // Editor was updated in-memory.
      expect(appendContentSpy).toHaveBeenCalledWith(appendedNodes);
      // lastContentRef was seeded before the event dispatched.
      expect(seedSpy).toHaveBeenCalledWith(updatedContent);
      expect(serviceMocks.cacheNotebook).toHaveBeenCalledTimes(1);

      // Wait a macrotask so the .then() + queueMicrotask dispatches run.
      await waitForMicrotasks();

      expect(events).toHaveLength(1);
      expect(events[0].detail).toEqual({ entity: "notebook" });
    } finally {
      window.removeEventListener("sync:entity-updated", listener);
    }
  });

  it("still caches + dispatches when the streaming preview owned the editor update", async () => {
    const seedSpy = vi.fn();
    mockNotebookEditorCallbackMap.current.set(
      "book-1",
      makeEditorCallbacks({ appendContent: appendContentSpy, seedLastContent: seedSpy }),
    );
    streamedToolCallIdRef.current.set("tc-1", { type: "doc", content: [] });

    const appendedNodes: JSONContent[] = [
      { type: "paragraph", content: [{ type: "text", text: "streamed" }] },
    ];
    const updatedContent: JSONContent = { type: "doc", content: appendedNodes };
    const updatedAt = 1_700_000_000_000;

    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener("sync:entity-updated", listener);

    try {
      const onFinish = getOnFinish();
      onFinish({
        message: makeAppendOutputMessage("tc-1", "streamed", appendedNodes, {
          updatedContent,
          updatedAt,
        }),
      });

      // Editor was NOT re-appended (streaming preview already handled it).
      expect(appendContentSpy).not.toHaveBeenCalled();
      // IDB cache still happens.
      expect(seedSpy).toHaveBeenCalledWith(updatedContent);
      expect(serviceMocks.cacheNotebook).toHaveBeenCalledTimes(1);

      await waitForMicrotasks();
      expect(events).toHaveLength(1);
      expect(events[0].detail).toEqual({ entity: "notebook" });
    } finally {
      window.removeEventListener("sync:entity-updated", listener);
    }
  });
});

describe("useChatToolHandlers – create_highlight", () => {
  it("preserves a server CFI without running fuzzy EPUB search", async () => {
    fuzzySearchEpubForCfi.mockClear();
    const appendHighlight = vi.fn();
    mockNotebookCallbackMap.current.set("book-1", appendHighlight);
    const { onFinish } = renderHookSimple(() =>
      useChatToolHandlers({
        bookId: "book-1",
        bookFormat: "epub",
        bookDataRef: { current: new ArrayBuffer(1) },
        streamedToolCallIdRef: { current: new Map<string, JSONContent>() },
      }),
    );
    const cfiRange = "epubcfi(/6/2!/4/2,/1:0,/1:7)";

    onFinish({
      message: {
        id: "msg-highlight",
        role: "assistant",
        parts: [
          {
            type: "tool-create_highlight",
            toolCallId: "tc-highlight",
            state: "output-available",
            input: { text: "passage" },
            output: {
              bookId: "book-1",
              created: true,
              highlight: {
                id: "highlight-1",
                bookId: "book-1",
                text: "passage",
                cfiRange,
                createdAt: 1,
                textAnchor: { chapterIndex: 0, snippet: "passage" },
              },
            },
          } as unknown as UIMessage["parts"][number],
        ],
      },
    });
    await waitForMicrotasks();

    expect(fuzzySearchEpubForCfi).not.toHaveBeenCalled();
    expect(appendHighlight).toHaveBeenCalledWith({
      highlightId: "highlight-1",
      cfiRange,
      text: "passage",
    });
  });

  it("does not save or append a highlight when server and client CFI resolution fail", async () => {
    fuzzySearchEpubForCfi.mockReset();
    fuzzySearchEpubForCfi.mockResolvedValue([]);
    const appendHighlight = vi.fn();
    mockNotebookCallbackMap.current.clear();
    mockNotebookCallbackMap.current.set("book-1", appendHighlight);
    serviceMocks.saveHighlight.mockClear();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { onFinish } = renderHookSimple(() =>
      useChatToolHandlers({
        bookId: "book-1",
        bookFormat: "epub",
        bookDataRef: { current: new ArrayBuffer(1) },
        streamedToolCallIdRef: { current: new Map<string, JSONContent>() },
      }),
    );

    try {
      onFinish({
        message: {
          id: "msg-highlight-failed",
          role: "assistant",
          parts: [
            {
              type: "tool-create_highlight",
              toolCallId: "tc-highlight-failed",
              state: "output-available",
              input: { text: "missing passage" },
              output: {
                bookId: "book-1",
                created: false,
                error: "exact_match_not_found",
              },
            } as unknown as UIMessage["parts"][number],
          ],
        },
      });
      await waitForMicrotasks();

      expect(fuzzySearchEpubForCfi).toHaveBeenCalled();
      expect(serviceMocks.saveHighlight).not.toHaveBeenCalled();
      expect(appendHighlight).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("useChatToolHandlers – edit_notes (server-authoritative)", () => {
  let streamedToolCallIdRef: { current: Map<string, JSONContent> };

  beforeEach(() => {
    streamedToolCallIdRef = { current: new Map<string, JSONContent>() };
    mockNotebookEditorCallbackMap.current.clear();
    mockNotebookContentChangeMap.current.clear();
    serviceMocks.cacheNotebook.mockClear();
    serviceMocks.cacheNotebook.mockResolvedValue(undefined);
  });

  function getOnFinish() {
    const { onFinish } = renderHookSimple(() =>
      useChatToolHandlers({
        bookId: "book-1",
        bookDataRef: { current: null },
        streamedToolCallIdRef,
      }),
    );
    return onFinish;
  }

  it("caches updatedContent with the server-provided updatedAt and dispatches sync:entity-updated", async () => {
    const setContentSpy = vi.fn();
    const seedSpy = vi.fn();
    mockNotebookEditorCallbackMap.current.set(
      "book-1",
      makeEditorCallbacks({ setContent: setContentSpy, seedLastContent: seedSpy }),
    );

    const updatedContent: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "rewritten" }] }],
    };
    const serverUpdatedAt = 1_700_000_123_456;

    const msg: UIMessage = {
      id: "msg-1",
      role: "assistant",
      parts: [
        {
          type: "tool-edit_notes",
          toolCallId: "tc-edit-1",
          state: "output-available",
          input: { code: "notebook.setContent('rewritten')" },
          output: { executed: true, updatedContent, updatedAt: serverUpdatedAt },
        } as unknown as UIMessage["parts"][number],
      ],
    };

    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener("sync:entity-updated", listener);

    // Spy on Date.now to guard against the pre-fix behavior of caching with
    // a fabricated client timestamp. The edit_notes path must not touch
    // Date.now — updatedAt is sourced exclusively from the server output.
    const dateNowSpy = vi.spyOn(Date, "now");

    try {
      const onFinish = getOnFinish();
      onFinish({ message: msg });

      expect(setContentSpy).toHaveBeenCalledWith(updatedContent);
      expect(seedSpy).toHaveBeenCalledWith(updatedContent);
      expect(serviceMocks.cacheNotebook).toHaveBeenCalledTimes(1);
      // No client-side timestamp fabrication on the success path.
      expect(dateNowSpy).not.toHaveBeenCalled();

      await waitForMicrotasks();
      expect(events).toHaveLength(1);
      expect(events[0].detail).toEqual({ entity: "notebook" });
    } finally {
      window.removeEventListener("sync:entity-updated", listener);
      dateNowSpy.mockRestore();
    }
  });

  it("skips cacheNotebook + sync event and warns when server omits updatedAt on executed:true", async () => {
    const setContentSpy = vi.fn();
    const seedSpy = vi.fn();
    mockNotebookEditorCallbackMap.current.set(
      "book-1",
      makeEditorCallbacks({ setContent: setContentSpy, seedLastContent: seedSpy }),
    );

    const updatedContent: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "no-ts" }] }],
    };

    const msg: UIMessage = {
      id: "msg-1",
      role: "assistant",
      parts: [
        {
          type: "tool-edit_notes",
          toolCallId: "tc-edit-2",
          state: "output-available",
          input: { code: "notebook.append('no-ts')" },
          // Intentionally missing updatedAt — regression guard against
          // fabricating freshness with Date.now() on the client.
          output: { executed: true, updatedContent },
        } as unknown as UIMessage["parts"][number],
      ],
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener("sync:entity-updated", listener);

    try {
      const onFinish = getOnFinish();
      onFinish({ message: msg });

      // Editor still gets the authoritative content (it's in-memory only).
      expect(setContentSpy).toHaveBeenCalledWith(updatedContent);
      expect(seedSpy).toHaveBeenCalledWith(updatedContent);
      // But NO IDB cache write and NO sync event — we don't fabricate freshness.
      expect(serviceMocks.cacheNotebook).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("edit_notes: server returned executed:true without updatedAt"),
      );

      await waitForMicrotasks();
      expect(events).toHaveLength(0);
    } finally {
      window.removeEventListener("sync:entity-updated", listener);
      warnSpy.mockRestore();
    }
  });
});
