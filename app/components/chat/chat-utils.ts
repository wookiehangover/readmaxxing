import type React from "react";
import type { UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { ChatMessage, SerializedPart } from "~/lib/chat-store";
import type { BookChapter } from "~/lib/epub-text-extract";

/** Extract a normalized tool info object from an AI SDK tool part (static or dynamic). */
export function getToolInfo(part: any): {
  toolName: string;
  state: string;
  input?: Record<string, unknown>;
  output?: any;
} | null {
  // Static tool parts have type "tool-{toolName}", dynamic have "dynamic-tool"
  if (part.type === "dynamic-tool") {
    return { toolName: part.toolName, state: part.state, input: part.input, output: part.output };
  }
  if (typeof part.type === "string" && part.type.startsWith("tool-")) {
    const toolName = part.type.slice(5); // strip "tool-" prefix
    return { toolName, state: part.state, input: part.input, output: part.output };
  }
  return null;
}

/** Serialize a UIMessage part for IndexedDB storage (strip non-serializable fields). */
export function serializePart(p: any): SerializedPart {
  if (p.type === "text") {
    return { type: "text", text: p.text };
  }
  if (p.type === "step-start") {
    return { type: "step-start" };
  }
  // Tool parts have type "tool-{name}" — preserve key fields for display on reload
  if (typeof p.type === "string" && p.type.startsWith("tool-")) {
    return {
      type: p.type,
      toolCallId: p.toolCallId,
      state: p.state,
      input: p.input,
      output: p.output,
    };
  }
  // Fallback: store type only
  return { type: p.type };
}

/** Convert our persisted ChatMessage[] to UIMessage[] for useChat */
export function toUIMessages(messages: ChatMessage[]): UIMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    parts:
      m.parts && m.parts.length > 0
        ? (m.parts as UIMessage["parts"])
        : [{ type: "text" as const, text: m.content }],
  }));
}

/** Convert UIMessage[] from useChat back to our ChatMessage[] for persistence */
export function toChatMessages(messages: UIMessage[]): ChatMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    content:
      m.parts
        ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("") ?? "",
    createdAt: Date.now(),
    parts: m.parts?.map(serializePart),
  }));
}

/** Parse suggested prompts from an HTML comment at the end of assistant text. */
export function parseSuggestedPrompts(text: string): string[] {
  const match = text.match(/<!--\s*suggested-prompts\s*\n([\s\S]*?)-->/);
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Strip the suggested-prompts HTML comment from display text. */
export function stripSuggestedPrompts(text: string): string {
  return text.replace(/<!--\s*suggested-prompts\s*\n[\s\S]*?-->/, "").trimEnd();
}

/**
 * Creates a DefaultChatTransport that dynamically injects the current chapter
 * index from a ref into every request body, rather than capturing a static value.
 */
export function createDynamicTransport(
  bookContext: { title: string; author: string; chapters: BookChapter[] },
  currentChapterRef: React.MutableRefObject<number | undefined>,
  notebookMarkdownRef: React.MutableRefObject<string>,
  visibleTextRef: React.MutableRefObject<string>,
) {
  const originalFetch = globalThis.fetch;
  const dynamicFetch: typeof globalThis.fetch = async (input, init) => {
    if (init?.body && typeof init.body === "string") {
      try {
        const parsed = JSON.parse(init.body);
        if (parsed.bookContext) {
          parsed.bookContext.currentChapterIndex = currentChapterRef.current;
          parsed.bookContext.notebookMarkdown = notebookMarkdownRef.current;
          parsed.bookContext.visibleText = visibleTextRef.current;
          init = { ...init, body: JSON.stringify(parsed) };
        }
      } catch {
        // not JSON, pass through
      }
    }
    return originalFetch(input, init);
  };

  return new DefaultChatTransport({
    api: "/api/chat",
    body: { bookContext },
    fetch: dynamicFetch,
  });
}
