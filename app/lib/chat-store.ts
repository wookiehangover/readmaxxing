import { createStore, get, set, del } from "idb-keyval";
import { Context, Effect, Layer } from "effect";
import { ChatError } from "~/lib/errors";

// --- Types ---

/** Serializable representation of a UIMessage part for IndexedDB persistence. */
export type SerializedPart =
  | { type: "text"; text: string }
  | { type: "step-start" }
  | {
      type: string;
      toolCallId?: string;
      state?: string;
      toolName?: string;
      input?: Record<string, unknown>;
      output?: unknown;
    };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  /** Full parts array from AI SDK UIMessage, preserved for tool call display on reload. */
  parts?: SerializedPart[];
}

// --- idb-keyval store (lazy-initialized for SSR safety) ---

let _chatStore: ReturnType<typeof createStore> | null = null;

function getChatStore() {
  if (!_chatStore) _chatStore = createStore("ebook-reader-chats", "chats");
  return _chatStore;
}

// --- Service interface ---

export class ChatService extends Context.Tag("ChatService")<
  ChatService,
  {
    readonly getMessages: (bookId: string) => Effect.Effect<ChatMessage[], ChatError>;
    readonly saveMessages: (
      bookId: string,
      messages: ChatMessage[],
    ) => Effect.Effect<void, ChatError>;
    readonly clearMessages: (bookId: string) => Effect.Effect<void, ChatError>;
  }
>() {}

// --- Live implementation ---

export const ChatServiceLive = Layer.succeed(ChatService, {
  getMessages: (bookId) =>
    Effect.tryPromise({
      try: async () => {
        const messages = await get<ChatMessage[]>(bookId, getChatStore());
        return messages ?? [];
      },
      catch: (cause) => new ChatError({ operation: "getMessages", cause }),
    }),

  saveMessages: (bookId, messages) =>
    Effect.tryPromise({
      try: () => set(bookId, messages, getChatStore()),
      catch: (cause) => new ChatError({ operation: "saveMessages", cause }),
    }),

  clearMessages: (bookId) =>
    Effect.tryPromise({
      try: () => del(bookId, getChatStore()),
      catch: (cause) => new ChatError({ operation: "clearMessages", cause }),
    }),
});
