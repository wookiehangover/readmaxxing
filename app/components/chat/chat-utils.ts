import type React from "react";
import type { UIMessage } from "@ai-sdk/react";
import { createChat } from "@shadcn/helpers/ai-sdk";
import { DefaultChatTransport } from "ai";
import {
  DEMO_CAPABILITIES_ANSWER,
  DEMO_BOOK_ID,
  DEMO_CHAT_SESSION,
  DEMO_INTRO_QUESTION,
  DEMO_SUGGESTED_QUESTIONS,
} from "~/lib/onboarding/demo-content";
import type { ChatMessage } from "~/lib/stores/chat-store";
import { ensureBookChaptersUploaded } from "~/lib/sync/book-chapter-uploads";

export const CHAT_SEND_RETRY_DELAYS_MS: readonly number[] = [250, 500, 1_000];

function requestSyncPush(): void {
  if (typeof window === "undefined") return;
  queueMicrotask(() => {
    window.dispatchEvent(new CustomEvent("sync:push-needed"));
  });
}

async function isRetryableChatResponse(response: Response): Promise<boolean> {
  if (response.status === 404) return true;
  if (response.status !== 400) return false;

  const body = await response
    .clone()
    .json()
    .catch(() => null);
  return (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string" &&
    body.error.startsWith("Book chapters not uploaded.")
  );
}

/** Build the ephemeral logged-out intro conversation used by the mock transport. */
export function createDemoIntroChat() {
  const suggestedPrompts = `<!-- suggested-prompts
${DEMO_SUGGESTED_QUESTIONS.join("\n")}
-->`;
  return createChat()
    .user(DEMO_INTRO_QUESTION)
    .sleep(700)
    .assistant(`${DEMO_CAPABILITIES_ANSWER}\n\n${suggestedPrompts}`);
}

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

/**
 * Join assistant text parts back into a single display string.
 *
 * Assistant responses can be split into multiple `text` parts at step/tool
 * boundaries. A naive `.join("")` drops any whitespace that originally
 * separated two parts (e.g. the space/newline between sentences that the model
 * emitted right at a boundary), producing run-together text like
 * "...end of chunk.Next sentence". This re-inserts a single space ONLY when the
 * previous part ends with a non-whitespace character AND the next part begins
 * with a non-whitespace character, so genuine sentence/paragraph boundaries keep
 * a separator while mid-word splits and markdown (code fences, lists) are not
 * corrupted by spurious spaces.
 */
export function joinTextParts(parts: string[]): string {
  let out = "";
  for (const part of parts) {
    if (out.length > 0 && part.length > 0) {
      const prevChar = out[out.length - 1];
      const nextChar = part[0];
      if (!/\s/.test(prevChar) && !/\s/.test(nextChar)) {
        out += " ";
      }
    }
    out += part;
  }
  return out;
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

/** Convert UIMessage[] from useChat back to our ChatMessage[] for the local
 *  warm-start cache (IDB). The server is the source of truth for chat
 *  messages; this is only used when reconciling server history into IDB so a
 *  subsequent cold reload renders the right thing immediately. */
export function uiMessagesToChatMessages(messages: UIMessage[]): ChatMessage[] {
  // Defensive: drop ephemeral, client-only book add/remove markers (`annot-`)
  // so they are never written to the warm-start IDB cache. They live in a
  // separate render-only list today, but this guards against accidental leaks.
  return messages
    .filter((m) => !m.id.startsWith("annot-"))
    .map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: joinTextParts(
        m.parts
          ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text) ?? [],
      ),
      createdAt: Date.now(),
      parts: m.parts?.map((p: any) => {
        if (p.type === "text") return { type: "text", text: p.text };
        if (p.type === "step-start") return { type: "step-start" };
        if (typeof p.type === "string" && p.type.startsWith("tool-")) {
          return {
            type: p.type,
            toolCallId: p.toolCallId,
            state: p.state,
            input: p.input,
            output: p.output,
          };
        }
        return { type: p.type };
      }),
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
 * Creates a DefaultChatTransport wired to the server-authoritative chat API.
 *
 * - `sendMessages` POSTs only the latest user message plus routing context
 *   (`sessionId`, `bookId`, `visibleText`, `currentChapterIndex`). When more
 *   than the primary book is selected it also sends `bookIds` (primary first)
 *   and a per-book `bookContexts` map. The server loads prior history from
 *   Postgres, so we don't ship the full message list.
 * - The selected-book set is read from `selectedBookIdsRef` at send time (not a
 *   stale closure) so a selection change between renders is always reflected.
 * - `reconnectToStream` is redirected to the custom resume endpoint
 *   `/api/chat/resume/:sessionId`, which replays an in-flight Redis stream.
 * - The custom `fetch` wrapper retries a short, finite number of times when
 *   `/api/chat` cannot yet see the book/session (404) or chapters (specific
 *   400). Each retry requests a sync push and awaits chapter upload first.
 */
export function createChatTransport(opts: {
  sessionId: string;
  bookId: string;
  visibleTextRef: React.MutableRefObject<string>;
  currentChapterRef: React.MutableRefObject<number | undefined>;
  /** Latest selected book IDs (primary first), read at send time. */
  selectedBookIdsRef: React.MutableRefObject<string[]>;
  /** Per-book reader context accessor, keyed by bookId. */
  getBookContext: (bookId: string) => {
    visibleText?: string;
    currentChapterIndex?: number;
  };
  onPreparingChange?: (preparing: boolean) => void;
}) {
  const fetchWithPreparationRetry: typeof fetch = async (input, init) => {
    if (opts.bookId === DEMO_BOOK_ID || opts.sessionId === DEMO_CHAT_SESSION.id) {
      throw new Error("Demo content must be adopted before using authenticated chat.");
    }

    // Only retry the POST /api/chat path — resume/messages endpoints have
    // their own ownership checks and shouldn't race on creation.
    const isChatPost = typeof input === "string" && input === "/api/chat";
    if (!isChatPost) return fetch(input, init);

    let preparing = false;
    try {
      for (const delayMs of [...CHAT_SEND_RETRY_DELAYS_MS, null]) {
        const response = await fetch(input, init);
        if (!(await isRetryableChatResponse(response)) || delayMs === null) return response;

        if (!preparing) {
          preparing = true;
          opts.onPreparingChange?.(true);
        }
        requestSyncPush();
        await ensureBookChaptersUploaded(opts.bookId);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      throw new Error("Chat send retry loop exhausted unexpectedly");
    } finally {
      if (preparing) opts.onPreparingChange?.(false);
    }
  };

  return new DefaultChatTransport<UIMessage>({
    api: "/api/chat",
    fetch: fetchWithPreparationRetry,
    prepareSendMessagesRequest: ({ messages }) => {
      // Read the latest selection at send time. Always include the primary
      // book first; dedupe defensively in case the same id appears twice.
      const selected = opts.selectedBookIdsRef.current ?? [opts.bookId];
      const bookIds = Array.from(new Set([opts.bookId, ...selected])).filter(
        (bookId) => bookId !== DEMO_BOOK_ID,
      );
      const bookContexts: Record<string, { visibleText?: string; currentChapterIndex?: number }> =
        {};
      for (const id of bookIds) {
        bookContexts[id] = opts.getBookContext(id);
      }
      return {
        body: {
          sessionId: opts.sessionId,
          // Primary book + its context, kept for back-compat.
          bookId: opts.bookId,
          visibleText: opts.visibleTextRef.current,
          currentChapterIndex: opts.currentChapterRef.current,
          // Multi-book contract (additive): all selected books, primary first.
          bookIds,
          bookContexts,
          message: messages[messages.length - 1],
        },
      };
    },
    prepareReconnectToStreamRequest: () => ({
      api: `/api/chat/resume/${encodeURIComponent(opts.sessionId)}`,
    }),
  });
}
