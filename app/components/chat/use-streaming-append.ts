import { useEffect, useRef } from "react";
import type { UIMessage } from "@ai-sdk/react";
import type { JSONContent } from "@tiptap/react";
import type { NotebookEditorCallbacks } from "~/lib/context/workspace-context";
import { markdownToTiptapJson } from "~/lib/editor/markdown-to-tiptap";
import { getToolInfo } from "./chat-utils";

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
  streamedToolCallIdRef: React.MutableRefObject<Map<string, JSONContent>>;
}) {
  const streamingRef = useRef<{
    toolCallId: string;
    baseNodeCount: number;
    originalContent: JSONContent;
    lastText: string;
  } | null>(null);

  useEffect(() => {
    if (status !== "streaming" || messages.length === 0) {
      streamingRef.current = null;
      return;
    }

    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role !== "assistant") return;

    const parts = lastMsg.parts ?? [];

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
        if (streamingRef.current?.toolCallId === toolCallId) {
          const text = typeof info.input?.text === "string" ? info.input.text : "";
          completedPart = { toolCallId, text };
        }
      }
    }

    const editorCallbacks = notebookEditorCallbackMap.current.get(bookId);
    if (!editorCallbacks) return;

    if (completedPart && streamingRef.current?.toolCallId === completedPart.toolCallId) {
      const parsed = markdownToTiptapJson(completedPart.text);
      const newNodes = parsed.content ?? [];
      editorCallbacks.replaceContentFrom(streamingRef.current.baseNodeCount, newNodes);

      streamedToolCallIdRef.current.set(
        completedPart.toolCallId,
        streamingRef.current.originalContent,
      );
      streamingRef.current = null;
      return;
    }

    if (streamingPart) {
      if (!streamingRef.current || streamingRef.current.toolCallId !== streamingPart.toolCallId) {
        streamingRef.current = {
          toolCallId: streamingPart.toolCallId,
          baseNodeCount: editorCallbacks.getTopLevelNodeCount(),
          originalContent: editorCallbacks.getContent(),
          lastText: "",
        };
      }

      if (streamingPart.text === streamingRef.current.lastText) return;
      streamingRef.current.lastText = streamingPart.text;

      const parsed = markdownToTiptapJson(streamingPart.text);
      const newNodes = parsed.content ?? [];
      editorCallbacks.replaceContentFrom(streamingRef.current.baseNodeCount, newNodes);
    }
  }, [messages, bookId, status, notebookEditorCallbackMap, streamedToolCallIdRef]);
}
