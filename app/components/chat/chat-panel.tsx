import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { Effect } from "effect";
import { useStickToBottom } from "use-stick-to-bottom";
import { Button } from "~/components/ui/button";
import { Trash2, ArrowDown } from "lucide-react";
import { ChatService } from "~/lib/chat-store";
import { BookService } from "~/lib/book-store";
import { AnnotationService } from "~/lib/annotations-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { tiptapJsonToMarkdown } from "~/lib/tiptap-to-markdown";
import { extractBookChapters, type BookChapter } from "~/lib/epub-text-extract";
import { cn } from "~/lib/utils";
import { useWorkspace } from "~/lib/workspace-context";
import {
  toUIMessages,
  toChatMessages,
  parseSuggestedPrompts,
  createDynamicTransport,
} from "./chat-utils";
import { ChatMessage } from "./chat-message";
import { ChatEmptyState, SuggestedPrompts } from "./chat-empty-state";
import { useChatToolHandlers } from "./use-chat-tool-handlers";
import { ChatInput } from "./chat-input";

interface ChatPanelProps {
  bookId: string;
  bookTitle: string;
}

export function ChatPanel({ bookId, bookTitle }: ChatPanelProps) {
  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(null);
  const [bookContext, setBookContext] = useState<{
    title: string;
    author: string;
    chapters: BookChapter[];
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const bookDataRef = useRef<ArrayBuffer | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef("");

  // Load chat history and book context on mount
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [savedMessages, book, bookData] = await Promise.all([
          AppRuntime.runPromise(ChatService.pipe(Effect.andThen((s) => s.getMessages(bookId)))),
          AppRuntime.runPromise(BookService.pipe(Effect.andThen((s) => s.getBook(bookId)))),
          AppRuntime.runPromise(BookService.pipe(Effect.andThen((s) => s.getBookData(bookId)))),
        ]);

        if (cancelled) return;

        const chapters = await extractBookChapters(bookData);
        if (cancelled) return;

        bookDataRef.current = bookData;
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
    return () => {
      cancelled = true;
    };
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
      bookDataRef={bookDataRef}
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
  bookDataRef,
  textareaRef,
  inputRef,
}: {
  bookId: string;
  bookTitle: string;
  initialMessages: UIMessage[];
  bookContext: { title: string; author: string; chapters: BookChapter[] };
  bookDataRef: React.RefObject<ArrayBuffer | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  inputRef: React.MutableRefObject<string>;
}) {
  const { chatContextMap } = useWorkspace();

  // Load notebook markdown for the AI's read_notes tool
  const [notebookMarkdown, setNotebookMarkdown] = useState<string>("");
  const notebookMarkdownRef = useRef(notebookMarkdown);
  notebookMarkdownRef.current = notebookMarkdown;

  useEffect(() => {
    if (!bookId) return;
    AppRuntime.runPromise(AnnotationService.pipe(Effect.andThen((svc) => svc.getNotebook(bookId))))
      .then((notebook) => {
        if (notebook?.content) {
          setNotebookMarkdown(tiptapJsonToMarkdown(notebook.content));
        }
      })
      .catch(console.error);
  }, [bookId]);

  // Refs that stay up-to-date with the reader's current chapter index and visible text
  const currentChapterRef = useRef<number | undefined>(undefined);
  const visibleTextRef = useRef<string>("");
  useEffect(() => {
    // Read initial value
    const ctx = chatContextMap.current.get(bookId);
    if (ctx) {
      currentChapterRef.current = ctx.currentChapterIndex;
      visibleTextRef.current = ctx.visibleText ?? "";
    }

    // Poll for updates (chatContextMap is updated by the reader's relocated event)
    const interval = setInterval(() => {
      const latest = chatContextMap.current.get(bookId);
      if (latest) {
        currentChapterRef.current = latest.currentChapterIndex;
        visibleTextRef.current = latest.visibleText ?? "";
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [bookId, chatContextMap]);

  const transport = useMemo(
    () =>
      createDynamicTransport(bookContext, currentChapterRef, notebookMarkdownRef, visibleTextRef),
    [bookContext],
  );

  // Use a ref-based persistMessages so onFinish always sees latest messages
  const messagesRef = useRef<UIMessage[]>(initialMessages);

  const persistMessages = useCallback(() => {
    const current = messagesRef.current;
    AppRuntime.runPromise(
      ChatService.pipe(Effect.andThen((s) => s.saveMessages(bookId, toChatMessages(current)))),
    ).catch(console.error);
  }, [bookId]);

  const { onFinish } = useChatToolHandlers({
    bookId,
    bookDataRef,
    persistMessages,
    setNotebookMarkdown,
  });

  const { messages, sendMessage, setMessages, status, stop } = useChat({
    id: `chat-${bookId}`,
    transport,
    messages: initialMessages,
    onFinish,
    onError: (err) => {
      console.error("Chat error:", err);
    },
  });

  // Keep messagesRef in sync
  messagesRef.current = messages;

  const isLoading = status === "streaming" || status === "submitted";

  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom();

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

  const handleClear = useCallback(() => {
    setMessages([]);
    AppRuntime.runPromise(ChatService.pipe(Effect.andThen((s) => s.clearMessages(bookId)))).catch(
      console.error,
    );
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
      <div
        ref={scrollRef}
        className={cn("flex-1 overflow-y-auto px-4 py-3 relative flex flex-col", {
          "scroll-fog": messages.length > 0,
        })}
      >
        <div ref={contentRef} className="flex flex-col flex-1">
          {messages.length === 0 && (
            <ChatEmptyState bookTitle={bookTitle} sendMessage={sendMessage} />
          )}
          <div className="space-y-3">
            {messages.map((message, i) => {
              const isLastAssistant = message.role === "assistant" && i === messages.length - 1;
              const isCurrentlyStreaming = status === "streaming" && i === messages.length - 1;

              return (
                <div key={message.id}>
                  <ChatMessage
                    message={message}
                    bookId={bookId}
                    bookDataRef={bookDataRef}
                    isStreaming={isCurrentlyStreaming}
                  />
                  {isLastAssistant && !isLoading && (
                    <SuggestedPrompts
                      prompts={parseSuggestedPrompts(
                        message.parts
                          ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
                          .map((p) => p.text)
                          .join("") ?? "",
                      )}
                      sendMessage={sendMessage}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {!isAtBottom && (
          <Button
            variant="outline"
            size="icon"
            className="absolute bottom-2 left-1/2 z-10 size-8 -translate-x-1/2 rounded-full shadow-md"
            onClick={() => scrollToBottom()}
          >
            <ArrowDown className="size-4" />
            <span className="sr-only">Scroll to bottom</span>
          </Button>
        )}
      </div>

      {/* Input */}
      <ChatInput
        textareaRef={textareaRef}
        inputRef={inputRef}
        isLoading={isLoading}
        onSubmit={handleSubmit}
        onStop={stop}
      />
    </div>
  );
}
