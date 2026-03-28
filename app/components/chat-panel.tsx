import { useEffect, useRef, useState, useCallback } from "react";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Effect } from "effect";
import { Button } from "~/components/ui/button";
import { SendHorizonal, Loader2, Trash2 } from "lucide-react";
import { ChatService, type ChatMessage } from "~/lib/chat-store";
import { BookService } from "~/lib/book-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { extractBookChapters, type BookChapter } from "~/lib/epub-text-extract";
import { cn } from "~/lib/utils";

interface ChatPanelProps {
  bookId: string;
  bookTitle: string;
}

/** Convert our persisted ChatMessage[] to UIMessage[] for useChat */
function toUIMessages(messages: ChatMessage[]): UIMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    parts: [{ type: "text" as const, text: m.content }],
  }));
}

/** Convert UIMessage[] from useChat back to our ChatMessage[] for persistence */
function toChatMessages(messages: UIMessage[]): ChatMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    content: m.parts
      ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("") ?? "",
    createdAt: Date.now(),
  }));
}

export function ChatPanel({ bookId, bookTitle }: ChatPanelProps) {
  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(null);
  const [bookContext, setBookContext] = useState<{
    title: string;
    author: string;
    chapters: BookChapter[];
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef("");

  // Load chat history and book context on mount
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [savedMessages, book] = await Promise.all([
          AppRuntime.runPromise(
            ChatService.pipe(Effect.andThen((s) => s.getMessages(bookId))),
          ),
          AppRuntime.runPromise(
            BookService.pipe(Effect.andThen((s) => s.getBook(bookId))),
          ),
        ]);

        if (cancelled) return;

        const chapters = await extractBookChapters(book.data);
        if (cancelled) return;

        setBookContext({ title: book.title, author: book.author, chapters });
        setInitialMessages(toUIMessages(savedMessages));
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load chat data:", err);
          setLoadError("Failed to load chat data.");
        }
      }
    };

    load();
    return () => { cancelled = true; };
  }, [bookId]);

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">{loadError}</p>
      </div>
    );
  }

  if (!initialMessages || !bookContext) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading chat…</p>
      </div>
    );
  }

  return (
    <ChatPanelInner
      bookId={bookId}
      bookTitle={bookTitle}
      initialMessages={initialMessages}
      bookContext={bookContext}
      messagesEndRef={messagesEndRef}
      textareaRef={textareaRef}
      inputRef={inputRef}
    />
  );
}

function ChatPanelInner({
  bookId,
  bookTitle,
  initialMessages,
  bookContext,
  messagesEndRef,
  textareaRef,
  inputRef,
}: {
  bookId: string;
  bookTitle: string;
  initialMessages: UIMessage[];
  bookContext: { title: string; author: string; chapters: BookChapter[] };
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  inputRef: React.MutableRefObject<string>;
}) {
  const { messages, sendMessage, setMessages, status, stop } = useChat({
    id: `chat-${bookId}`,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: { bookContext },
    }),
    messages: initialMessages,
    onFinish: () => {
      // Persist after assistant finishes
      persistMessages();
    },
    onError: (err) => {
      console.error("Chat error:", err);
    },
  });

  const isLoading = status === "streaming" || status === "submitted";

  const persistMessages = useCallback(() => {
    const current = messages;
    AppRuntime.runPromise(
      ChatService.pipe(
        Effect.andThen((s) => s.saveMessages(bookId, toChatMessages(current))),
      ),
    ).catch(console.error);
  }, [bookId, messages]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, messagesEndRef]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const text = inputRef.current.trim();
      if (!text || isLoading) return;
      sendMessage({ text });
      inputRef.current = "";
      if (textareaRef.current) {
        textareaRef.current.value = "";
      }
    },
    [sendMessage, isLoading, inputRef, textareaRef],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        const form = e.currentTarget.form;
        form?.requestSubmit();
      }
    },
    [],
  );

  const handleClear = useCallback(() => {
    setMessages([]);
    AppRuntime.runPromise(
      ChatService.pipe(Effect.andThen((s) => s.clearMessages(bookId))),
    ).catch(console.error);
  }, [setMessages, bookId]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h3 className="truncate text-sm font-medium">{bookTitle}</h3>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClear}
          title="Clear chat"
          className="size-7"
        >
          <Trash2 className="size-3.5" />
          <span className="sr-only">Clear chat</span>
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-center text-sm text-muted-foreground">
              Ask a question about this book to start a conversation.
            </p>
          </div>
        )}
        <div className="space-y-3">
          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            className={cn(
              "flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-sm",
              "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "field-sizing-content max-h-[6lh] min-h-[2.5rem]",
            )}
            placeholder="Ask about this book…"
            onChange={(e) => { inputRef.current = e.target.value; }}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            rows={1}
          />
          {isLoading ? (
            <Button type="button" variant="ghost" size="icon" onClick={stop} title="Stop">
              <Loader2 className="size-4 animate-spin" />
              <span className="sr-only">Stop</span>
            </Button>
          ) : (
            <Button type="submit" size="icon" title="Send">
              <SendHorizonal className="size-4" />
              <span className="sr-only">Send</span>
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function ChatMessage({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const text = message.parts
    ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("") ?? "";

  return (
    <div className={cn("flex", { "justify-end": isUser, "justify-start": !isUser })}>
      <div
        className={cn("max-w-[85%] rounded-lg px-3 py-2 text-sm", {
          "bg-secondary text-secondary-foreground": isUser,
          "bg-muted text-foreground": !isUser,
        })}
      >
        <p className="whitespace-pre-wrap">{text}</p>
      </div>
    </div>
  );
}
