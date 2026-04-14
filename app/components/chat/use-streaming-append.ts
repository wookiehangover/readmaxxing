import { useEffect, useRef } from "react";
import type { UIMessage } from "@ai-sdk/react";
import type { NotebookEditorCallbacks } from "~/lib/context/workspace-context";
import { markdownToTiptapJson } from "~/lib/editor/markdown-to-tiptap";
import { getToolInfo } from "./chat-utils";

/**
 * Watches chat messages for `append_to_notes` tool invocations in `input-streaming`
 * state and pushes partial content to the notebook editor in real-time.
 *
 * Returns a ref that is set to `true` when streaming has inserted content,
 * so the `onToolCall` handler can skip the duplicate final insert.
 */
export function useStreamingAppend({
  messages,
  bookId,
  status,
  notebookEditorCallbackMap,
  streamedToolCallIdRef,
}: {
  messages: UIMessage[];
  bookId: string;
  status: string;
  notebookEditorCallbackMap: React.MutableRefObject<Map<string, NotebookEditorCallbacks>>;
  /** Shared ref — set to the toolCallId when streaming inserted the final content */
  streamedToolCallIdRef: React.MutableRefObject<string | null>;
}) {
  // Track whether we are currently streaming and the baseline node count
  const streamingRef = useRef<{
    toolCallId: string;
    baseNodeCount: number;
    lastText: string;
  } | null>(null);

  useEffect(() => {
    if (status !== "streaming" || messages.length === 0) {
      // Not streaming — clean up
      streamingRef.current = null;
      return;
    }

    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role !== "assistant") return;

    const parts = lastMsg.parts ?? [];

    // Find any append_to_notes tool part that is currently streaming input
    let streamingPart: { toolCallId: string; text: string } | null = null;
    let completedPart: { toolCallId: string; text: string } | null = null;

    for (const part of parts) {
      const info = getToolInfo(part);
      if (!info || info.toolName !== "append_to_notes") continue;

      const toolCallId = (part as any).toolCallId as string | undefined;
      if (!toolCallId) continue;

      if (info.state === "input-streaming") {
        const text = typeof info.input?.text === "string" ? info.input.text : "";
        if (text.length > 0) {
          streamingPart = { toolCallId, text };
        }
      } else if (info.state === "input-available" || info.state === "output-available") {
        // Tool call completed — if we were streaming this one, mark it
        if (streamingRef.current?.toolCallId === toolCallId) {
          const text = typeof info.input?.text === "string" ? info.input.text : "";
          completedPart = { toolCallId, text };
        }
      }
    }

    const editorCallbacks = notebookEditorCallbackMap.current.get(bookId);
    if (!editorCallbacks) return;

    // Handle completion of a streamed tool call
    if (completedPart && streamingRef.current?.toolCallId === completedPart.toolCallId) {
      // Do final replace with complete text
      const parsed = markdownToTiptapJson(completedPart.text);
      const newNodes = parsed.content ?? [];
      editorCallbacks.replaceContentFrom(streamingRef.current.baseNodeCount, newNodes);

      streamedToolCallIdRef.current = completedPart.toolCallId;
      streamingRef.current = null;
      return;
    }

    // Handle active streaming
    if (streamingPart) {
      // If this is a new streaming tool call, record baseline
      if (!streamingRef.current || streamingRef.current.toolCallId !== streamingPart.toolCallId) {
        streamingRef.current = {
          toolCallId: streamingPart.toolCallId,
          baseNodeCount: editorCallbacks.getTopLevelNodeCount(),
          lastText: "",
        };
      }

      // Skip if text hasn't changed
      if (streamingPart.text === streamingRef.current.lastText) return;
      streamingRef.current.lastText = streamingPart.text;

      // Parse partial markdown and replace streamed content
      const parsed = markdownToTiptapJson(streamingPart.text);
      const newNodes = parsed.content ?? [];
      editorCallbacks.replaceContentFrom(streamingRef.current.baseNodeCount, newNodes);
    }
  }, [messages, bookId, status, notebookEditorCallbackMap, streamedToolCallIdRef]);
}
