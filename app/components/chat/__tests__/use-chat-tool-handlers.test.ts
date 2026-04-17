import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NotebookEditorCallbacks } from "~/lib/context/workspace-context";
import type { JSONContent } from "@tiptap/react";
import type { UIMessage } from "@ai-sdk/react";

// Mock useWorkspace to return controllable refs
const mockNotebookEditorCallbackMap = { current: new Map<string, NotebookEditorCallbacks>() };
const mockNotebookContentChangeMap = {
  current: new Map<string, (markdown: string) => void>(),
};

vi.mock("~/lib/context/workspace-context", () => ({
  useWorkspace: () => ({
    waitForNavForBook: vi.fn(),
    applyTempHighlightForBook: vi.fn(),
    notebookCallbackMap: { current: new Map() },
    notebookEditorCallbackMap: mockNotebookEditorCallbackMap,
    notebookContentChangeMap: mockNotebookContentChangeMap,
  }),
}));

// Mock effect runtime to avoid real IndexedDB
vi.mock("~/lib/effect-runtime", () => ({
  AppRuntime: {
    runPromise: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("~/lib/stores/annotations-store", () => ({
  AnnotationService: {
    pipe: vi.fn(),
  },
}));

// Must import AFTER mocks are set up
const { useChatToolHandlers } = await import("../use-chat-tool-handlers");
import { renderHookSimple } from "./render-hook-simple";

function makeAppendOutputMessage(
  toolCallId: string,
  text: string,
  appendedNodes: JSONContent[],
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
        output: { appended: true, text, appendedNodes },
      } as unknown as UIMessage["parts"][number],
    ],
  };
}

describe("useChatToolHandlers – append_to_notes (server-authoritative)", () => {
  let streamedToolCallIdRef: { current: Set<string> };
  let appendContentSpy: ReturnType<typeof vi.fn<(nodes: JSONContent[]) => void>>;

  beforeEach(() => {
    streamedToolCallIdRef = { current: new Set<string>() };
    appendContentSpy = vi.fn();
    mockNotebookEditorCallbackMap.current.clear();
    mockNotebookContentChangeMap.current.clear();
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
    mockNotebookEditorCallbackMap.current.set("book-1", {
      appendContent: appendContentSpy,
      setContent: vi.fn(),
      getContent: vi.fn().mockReturnValue({ type: "doc", content: [] }),
      getTopLevelNodeCount: vi.fn().mockReturnValue(0),
      replaceContentFrom: vi.fn(),
    });

    const appendedNodes: JSONContent[] = [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Hello" }] },
    ];
    const onFinish = getOnFinish();
    onFinish({ message: makeAppendOutputMessage("tc-1", "# Hello", appendedNodes) });

    expect(appendContentSpy).toHaveBeenCalledTimes(1);
    expect(appendContentSpy).toHaveBeenCalledWith(appendedNodes);
  });

  it("skips appendContent when the streaming preview already inserted the nodes", () => {
    mockNotebookEditorCallbackMap.current.set("book-1", {
      appendContent: appendContentSpy,
      setContent: vi.fn(),
      getContent: vi.fn().mockReturnValue({ type: "doc", content: [] }),
      getTopLevelNodeCount: vi.fn().mockReturnValue(0),
      replaceContentFrom: vi.fn(),
    });

    streamedToolCallIdRef.current.add("tc-1");

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
    mockNotebookEditorCallbackMap.current.set("book-1", {
      appendContent: appendContentSpy,
      setContent: vi.fn(),
      getContent: vi.fn().mockReturnValue({ type: "doc", content: [] }),
      getTopLevelNodeCount: vi.fn().mockReturnValue(0),
      replaceContentFrom: vi.fn(),
    });

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
  });
});
