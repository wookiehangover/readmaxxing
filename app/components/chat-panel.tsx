import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Effect } from "effect";
import { Button } from "~/components/ui/button";
import { SendHorizonal, Loader2, Trash2, ChevronRight } from "lucide-react";
import { Streamdown } from "streamdown";
import type { Components } from "streamdown";
import { ChatService, type ChatMessage } from "~/lib/chat-store";
import { BookService } from "~/lib/book-store";
import { AnnotationService } from "~/lib/annotations-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { tiptapJsonToMarkdown } from "~/lib/tiptap-to-markdown";
import { extractBookChapters, type BookChapter } from "~/lib/epub-text-extract";
import { cn } from "~/lib/utils";
import { useWorkspace } from "~/lib/workspace-context";

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
  const bookDataRef = useRef<ArrayBuffer | null>(null);
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

        bookDataRef.current = book.data;
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
      bookDataRef={bookDataRef}
      messagesEndRef={messagesEndRef}
      textareaRef={textareaRef}
      inputRef={inputRef}
    />
  );
}

/**
 * Creates a DefaultChatTransport that dynamically injects the current chapter
 * index from a ref into every request body, rather than capturing a static value.
 */
function createDynamicTransport(
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

function ChatPanelInner({
  bookId,
  bookTitle,
  initialMessages,
  bookContext,
  bookDataRef,
  messagesEndRef,
  textareaRef,
  inputRef,
}: {
  bookId: string;
  bookTitle: string;
  initialMessages: UIMessage[];
  bookContext: { title: string; author: string; chapters: BookChapter[] };
  bookDataRef: React.RefObject<ArrayBuffer | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  inputRef: React.MutableRefObject<string>;
}) {
  const { chatContextMap, notebookCallbackMap, findNavForBook } = useWorkspace();

  // Load notebook markdown for the AI's read_notes tool
  const [notebookMarkdown, setNotebookMarkdown] = useState<string>("");
  const notebookMarkdownRef = useRef(notebookMarkdown);
  notebookMarkdownRef.current = notebookMarkdown;

  useEffect(() => {
    if (!bookId) return;
    AppRuntime.runPromise(
      AnnotationService.pipe(
        Effect.andThen((svc) => svc.getNotebook(bookId)),
      ),
    ).then((notebook) => {
      if (notebook?.content) {
        setNotebookMarkdown(tiptapJsonToMarkdown(notebook.content));
      }
    }).catch(console.error);
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
    () => createDynamicTransport(bookContext, currentChapterRef, notebookMarkdownRef, visibleTextRef),
    [bookContext],
  );

  const { messages, sendMessage, setMessages, status, stop } = useChat({
    id: `chat-${bookId}`,
    transport,
    messages: initialMessages,
    onFinish: (event) => {
      // Persist after assistant finishes
      persistMessages();

      // Handle append_to_notes tool calls
      const msg = event.message;
      const appendParts = msg.parts?.filter(
        (p: any) =>
          p.type === "tool-invocation" &&
          p.toolInvocation?.toolName === "append_to_notes" &&
          p.toolInvocation?.state === "result",
      ) ?? [];

      for (const part of appendParts) {
        const text = (part as any).toolInvocation?.args?.text;
        if (!text || !bookId) continue;

        const newNodes = text.split("\n").filter(Boolean).map((line: string) => ({
          type: "paragraph" as const,
          content: [{ type: "text" as const, text: line }],
        }));

        AppRuntime.runPromise(
          Effect.gen(function* () {
            const svc = yield* AnnotationService;
            const notebook = yield* svc.getNotebook(bookId);
            const existingContent = notebook?.content?.content ?? [];
            const updatedContent = {
              type: "doc" as const,
              content: [...existingContent, ...newNodes],
            };
            yield* svc.saveNotebook({
              bookId,
              content: updatedContent,
              updatedAt: Date.now(),
            });
          }),
        ).then(() => {
          setNotebookMarkdown((prev) => prev + "\n" + text);
        }).catch(console.error);
      }

      // Handle create_highlight tool calls
      const highlightParts = msg.parts?.filter(
        (p: any) =>
          p.type === "tool-invocation" &&
          p.toolInvocation?.toolName === "create_highlight" &&
          p.toolInvocation?.state === "result",
      ) ?? [];

      for (const part of highlightParts) {
        const args = (part as any).toolInvocation?.args as
          | { text?: string; note?: string }
          | undefined;
        const highlightText = args?.text;
        if (!highlightText || !bookId) continue;

        const data = bookDataRef.current;
        if (!data) continue;

        // Search for the text in the book to get a CFI, then persist the highlight
        (async () => {
          try {
            const ePub = (await import("epubjs")).default;
            const { searchBookForCfi } = await import("~/lib/epub-search");
            const tempBook = ePub(data);
            try {
              const results = await searchBookForCfi(tempBook, highlightText);
              if (results.length === 0) return;

              const cfiRange = results[0].cfi;
              const highlight = {
                id: crypto.randomUUID(),
                bookId,
                cfiRange,
                text: highlightText,
                color: "rgba(255, 213, 79, 0.4)",
                createdAt: Date.now(),
              };

              // Persist highlight to IndexedDB
              await AppRuntime.runPromise(
                Effect.gen(function* () {
                  const svc = yield* AnnotationService;
                  yield* svc.saveHighlight(highlight);
                }),
              );

              // Navigate to the highlight in the reader
              const navigate = findNavForBook(bookId);
              if (navigate) {
                navigate(cfiRange);
              }

              // Add HighlightReference to the notebook
              const appendFn = notebookCallbackMap.current.get(bookId);
              if (appendFn) {
                appendFn({
                  highlightId: highlight.id,
                  cfiRange: highlight.cfiRange,
                  text: highlight.text,
                });
              }
            } finally {
              tempBook.destroy();
            }
          } catch (err) {
            console.warn("Failed to create highlight from AI tool:", err);
          }
        })();
      }
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
          <ChatEmptyState bookTitle={bookTitle} sendMessage={sendMessage} />
        )}
        <div className="space-y-3">
          {messages.map((message, i) => (
            <ChatMessage
              key={message.id}
              message={message}
              bookId={bookId}
              bookDataRef={bookDataRef}
              isStreaming={status === "streaming" && i === messages.length - 1}
            />
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

const SUGGESTION_CATEGORIES = [
  {
    label: "Summarize & Explore",
    suggestions: [
      "What is this book about?",
      "Summarize the chapter I'm reading",
      "What are the key themes?",
    ],
  },
  {
    label: "Examine & Debate",
    suggestions: [
      "What's the strongest argument in this chapter?",
      "What would a critic say about this book's thesis?",
    ],
  },
  {
    label: "Pull the Thread",
    suggestions: [
      "What ideas connect across multiple chapters?",
    ],
  },
];

function ChatEmptyState({
  bookTitle,
  sendMessage,
}: {
  bookTitle: string;
  sendMessage: (message: { text: string }) => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-2">
      <p className="text-center text-sm text-muted-foreground">
        Ask about <span className="italic">{bookTitle}</span>
      </p>
      <div className="flex w-full max-w-sm flex-col gap-4">
        {SUGGESTION_CATEGORIES.map((category) => (
          <div key={category.label} className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {category.label}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {category.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm text-foreground",
                    "transition-colors hover:bg-accent hover:text-accent-foreground",
                    "cursor-pointer",
                  )}
                  onClick={() => sendMessage({ text: suggestion })}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChatMessage({
  message,
  bookId,
  bookDataRef,
  isStreaming,
}: {
  message: UIMessage;
  bookId: string;
  bookDataRef: React.RefObject<ArrayBuffer | null>;
  isStreaming?: boolean;
}) {
  const isUser = message.role === "user";
  const { findNavForBook } = useWorkspace();

  const textParts =
    message.parts?.filter(
      (p): p is { type: "text"; text: string } => p.type === "text",
    ) ?? [];
  const toolParts =
    message.parts?.filter((p) => p.type === "tool-invocation") ?? [];
  const reasoningParts =
    message.parts?.filter((p) => p.type === "reasoning") ?? [];

  const text = textParts.map((p) => p.text).join("");
  const hasProcessSteps = toolParts.length > 0 || reasoningParts.length > 0;

  const streamdownComponents = useMemo<Components>(() => ({
    ref: ({ children, chapter, query }: Record<string, unknown>) => {
      const queryStr = typeof query === "string" ? query : "";
      if (!queryStr) {
        // No query — render as plain text
        return <span>{children as React.ReactNode}</span>;
      }

      const handleClick = async () => {
        const data = bookDataRef.current;
        if (!data) return;

        try {
          const ePub = (await import("epubjs")).default;
          const { searchBookForCfi } = await import("~/lib/epub-search");
          const book = ePub(data);
          try {
            const results = await searchBookForCfi(book, queryStr);
            if (results.length > 0) {
              const navigate = findNavForBook(bookId);
              if (navigate) {
                navigate(results[0].cfi);
              }
            }
          } finally {
            book.destroy();
          }
        } catch (err) {
          console.warn("Ref navigation failed:", err);
        }
      };

      return (
        <span
          role="button"
          tabIndex={0}
          onClick={handleClick}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleClick(); }}
          className="underline decoration-dotted underline-offset-2 cursor-pointer hover:decoration-solid transition-all inline"
          title={`Go to: "${queryStr}"`}
        >
          {children as React.ReactNode}
        </span>
      );
    },
  }), [bookId, bookDataRef, findNavForBook]);

  return (
    <div
      className={cn("flex", {
        "justify-end": isUser,
        "justify-start": !isUser,
      })}
    >
      <div
        className={cn("max-w-[85%] rounded-lg px-3 py-2 text-sm", {
          "bg-secondary text-secondary-foreground": isUser,
          "bg-muted text-foreground": !isUser,
        })}
      >
        {hasProcessSteps && (
          <details className="group mb-2">
            <summary className="cursor-pointer text-xs text-muted-foreground flex items-center gap-1 list-none [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
              {toolParts.length > 0 &&
                `${toolParts.length} step${toolParts.length > 1 ? "s" : ""}`}
              {reasoningParts.length > 0 &&
                toolParts.length === 0 &&
                "Reasoning"}
            </summary>
            <div className="mt-1 space-y-1 pl-4 text-xs text-muted-foreground">
              {toolParts.map((part, i) => {
                const inv = (part as any).toolInvocation as
                  | {
                      toolName: string;
                      args?: Record<string, unknown>;
                    }
                  | undefined;
                if (!inv) return null;
                let label = inv.toolName;
                if (inv.toolName === "search_book")
                  label = `Searched for "${inv.args?.query}"`;
                else if (inv.toolName === "read_chapter") {
                  label = inv.args?.chapterTitle
                    ? `Read chapter: ${inv.args.chapterTitle}`
                    : `Read chapter ${inv.args?.chapterIndex}`;
                } else if (inv.toolName === "create_highlight") {
                  const snippet = typeof inv.args?.text === "string"
                    ? inv.args.text.slice(0, 50) + (inv.args.text.length > 50 ? "…" : "")
                    : "";
                  label = `Highlighted: "${snippet}"`;
                }
                return (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className="size-1 rounded-full bg-muted-foreground/50" />
                    {label}
                  </div>
                );
              })}
              {reasoningParts.map((part, i) => (
                <div key={`r-${i}`} className="italic">
                  {(part as any).reasoning}
                </div>
              ))}
            </div>
          </details>
        )}
        {text &&
          (isUser ? (
            <p className="whitespace-pre-wrap">{text}</p>
          ) : (
            <Streamdown
              animated={{
                animation: "fadeIn",
                duration: 150,
                easing: "ease-out",

              }}
              isAnimating={isStreaming}
              className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
              allowedTags={{ ref: ["chapter", "query"] }}
              components={streamdownComponents}
            >
              {text}
            </Streamdown>
          ))}
      </div>
    </div>
  );
}
