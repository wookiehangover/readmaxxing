import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NotebookEditorCallbacks } from "~/lib/context/workspace-context";
import type { JSONContent } from "@tiptap/react";

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

function makeToolCall(toolName: string, input: Record<string, unknown>, toolCallId?: string) {
  return { toolCall: { toolName, input, toolCallId } };
}

describe("useChatToolHandlers – append_to_notes dedup", () => {
  let setNotebookMarkdown: React.Dispatch<React.SetStateAction<string>>;
  let setNotebookMarkdownMock: ReturnType<typeof vi.fn>;
  let streamedToolCallIdRef: { current: string | null };
  let appendContentSpy: ReturnType<typeof vi.fn<(nodes: JSONContent[]) => void>>;

  beforeEach(() => {
    setNotebookMarkdownMock = vi.fn();
    setNotebookMarkdown = setNotebookMarkdownMock as unknown as React.Dispatch<
      React.SetStateAction<string>
    >;
    streamedToolCallIdRef = { current: null };
    appendContentSpy = vi.fn();
    mockNotebookEditorCallbackMap.current.clear();
    mockNotebookContentChangeMap.current.clear();
  });

  function getOnToolCall() {
    const { onToolCall } = renderHookSimple(() =>
      useChatToolHandlers({
        bookId: "book-1",
        bookDataRef: { current: null },
        persistMessages: vi.fn(),
        setNotebookMarkdown,
        streamedToolCallIdRef,
      }),
    );
    return onToolCall;
  }

  it("does NOT call setNotebookMarkdown when editor is open (non-streaming)", async () => {
    // Simulate notebook panel open — register editor callbacks
    mockNotebookEditorCallbackMap.current.set("book-1", {
      appendContent: appendContentSpy,
      setContent: vi.fn(),
      getContent: vi.fn().mockReturnValue({ type: "doc", content: [] }),
      getTopLevelNodeCount: vi.fn().mockReturnValue(0),
      replaceContentFrom: vi.fn(),
    });

    const onToolCall = getOnToolCall();
    await onToolCall(makeToolCall("append_to_notes", { text: "# Hello" }));

    // Editor receives the content
    expect(appendContentSpy).toHaveBeenCalledTimes(1);
    // But setNotebookMarkdown is NOT called — editor onUpdate handles it
    expect(setNotebookMarkdownMock).not.toHaveBeenCalled();
  });

  it("does NOT call setNotebookMarkdown when streaming already inserted (editor open)", async () => {
    mockNotebookEditorCallbackMap.current.set("book-1", {
      appendContent: appendContentSpy,
      setContent: vi.fn(),
      getContent: vi.fn().mockReturnValue({ type: "doc", content: [] }),
      getTopLevelNodeCount: vi.fn().mockReturnValue(0),
      replaceContentFrom: vi.fn(),
    });

    // Streaming hook already inserted content for this tool call
    streamedToolCallIdRef.current = "tc-123";

    const onToolCall = getOnToolCall();
    await onToolCall(makeToolCall("append_to_notes", { text: "# Hello" }, "tc-123"));

    // Streaming path: early return, no appendContent, no setNotebookMarkdown
    expect(appendContentSpy).not.toHaveBeenCalled();
    expect(setNotebookMarkdownMock).not.toHaveBeenCalled();
    // Ref is cleared
    expect(streamedToolCallIdRef.current).toBeNull();
  });

  it("DOES call setNotebookMarkdown when editor is NOT open (fallback)", async () => {
    // No editor callbacks registered — notebook panel is closed
    const onToolCall = getOnToolCall();
    await onToolCall(makeToolCall("append_to_notes", { text: "# Hello" }));

    // Falls back to IndexedDB write + manual markdown update
    expect(setNotebookMarkdownMock).toHaveBeenCalledTimes(1);
    expect(appendContentSpy).not.toHaveBeenCalled();
  });
});
