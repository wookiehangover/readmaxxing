import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Effect } from "effect";
import { useStickToBottom } from "use-stick-to-bottom";
import { Button } from "~/components/ui/button";
import {
  SendHorizonal,
  Loader2,
  Trash2,
  ChevronRight,
  Globe,
  Plus,
  Check,
  ArrowDown,
} from "lucide-react";
import { Streamdown } from "streamdown";
import type { Components } from "streamdown";
import { ChatService, type ChatMessage, type SerializedPart } from "~/lib/chat-store";
import { BookService, type BookMeta } from "~/lib/book-store";
import { AnnotationService } from "~/lib/annotations-store";
import { StandardEbooksService, type SEBook } from "~/lib/standard-ebooks";
import { parseEpubEffect } from "~/lib/epub-service";
import { AppRuntime } from "~/lib/effect-runtime";
import { tiptapJsonToMarkdown } from "~/lib/tiptap-to-markdown";
import { extractBookChapters, type BookChapter } from "~/lib/epub-text-extract";
import { cn } from "~/lib/utils";
import { useWorkspace } from "~/lib/workspace-context";

/** Extract a normalized tool info object from an AI SDK tool part (static or dynamic). */
function getToolInfo(part: any): {
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

interface ChatPanelProps {
  bookId: string;
  bookTitle: string;
}

/** Serialize a UIMessage part for IndexedDB storage (strip non-serializable fields). */
function serializePart(p: any): SerializedPart {
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
function toUIMessages(messages: ChatMessage[]): UIMessage[] {
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
function toChatMessages(messages: UIMessage[]): ChatMessage[] {
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
  const { chatContextMap, notebookCallbackMap, waitForNavForBook, applyTempHighlightForBook } =
    useWorkspace();

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

  const { messages, sendMessage, setMessages, status, stop } = useChat({
    id: `chat-${bookId}`,
    transport,
    messages: initialMessages,
    onFinish: (event) => {
      // Persist after assistant finishes
      persistMessages();

      // Handle append_to_notes tool calls
      const msg = event.message;
      const appendParts = (msg.parts ?? []).filter((p: any) => {
        const info = getToolInfo(p);
        return info && info.toolName === "append_to_notes" && info.state === "output-available";
      });

      for (const part of appendParts) {
        const info = getToolInfo(part);
        const text = typeof info?.input?.text === "string" ? info.input.text : undefined;
        if (!text || !bookId) continue;

        const newNodes = text
          .split("\n")
          .filter(Boolean)
          .map((line: string) => ({
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
        )
          .then(() => {
            setNotebookMarkdown((prev) => prev + "\n" + text);
          })
          .catch(console.error);
      }

      // Handle create_highlight tool calls
      const highlightParts = (msg.parts ?? []).filter((p: any) => {
        const info = getToolInfo(p);
        return info && info.toolName === "create_highlight" && info.state === "output-available";
      });

      for (const part of highlightParts) {
        const info = getToolInfo(part);
        const highlightText = typeof info?.input?.text === "string" ? info.input.text : undefined;
        if (!highlightText || !bookId) continue;

        const data = bookDataRef.current;
        if (!data) continue;

        // Search for the text in the book to get a CFI, then persist the highlight
        (async () => {
          try {
            const ePub = (await import("epubjs")).default;
            const { fuzzySearchBookForCfi } = await import("~/lib/epub-search");
            const tempBook = ePub(data.slice(0));
            try {
              const results = await fuzzySearchBookForCfi(tempBook, highlightText);
              if (results.length === 0) {
                console.warn(
                  "create_highlight: no search results for:",
                  highlightText.slice(0, 60),
                );
                return;
              }

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

              // Navigate to the highlight and show temp highlight in the reader
              const navigate = await waitForNavForBook(bookId);
              if (navigate) {
                navigate(cfiRange);
              }
              applyTempHighlightForBook(bookId, cfiRange);

              // Add HighlightReference to the notebook (fall back to direct save if panel isn't open)
              const appendFn = notebookCallbackMap.current.get(bookId);
              if (appendFn) {
                appendFn({
                  highlightId: highlight.id,
                  cfiRange: highlight.cfiRange,
                  text: highlight.text,
                });
              } else {
                // Notebook panel not open — append directly via AnnotationService
                AppRuntime.runPromise(
                  Effect.gen(function* () {
                    const svc = yield* AnnotationService;
                    const notebook = yield* svc.getNotebook(bookId);
                    const existingContent = notebook?.content?.content ?? [];
                    const highlightNode = {
                      type: "highlightReference" as const,
                      attrs: {
                        highlightId: highlight.id,
                        cfiRange: highlight.cfiRange,
                        text: highlight.text,
                      },
                    };
                    const updatedContent = {
                      type: "doc" as const,
                      content: [...existingContent, highlightNode],
                    };
                    yield* svc.saveNotebook({
                      bookId,
                      content: updatedContent,
                      updatedAt: Date.now(),
                    });
                  }),
                ).catch(console.error);
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
      ChatService.pipe(Effect.andThen((s) => s.saveMessages(bookId, toChatMessages(current)))),
    ).catch(console.error);
  }, [bookId, messages]);

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

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const form = e.currentTarget.form;
      form?.requestSubmit();
    }
  }, []);

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
      <form onSubmit={handleSubmit} className="px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            className={cn(
              "flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-sm",
              "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "field-sizing-content max-h-[6lh] min-h-10",
            )}
            placeholder="Ask about this book…"
            onChange={(e) => {
              inputRef.current = e.target.value;
            }}
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
      "Give me a Straussian reading of this chapter",
    ],
  },
  {
    label: "Pull the Thread",
    suggestions: [
      "What ideas connect across multiple chapters?",
      "What would Tyler Cowen think about this?",
      "What else should I read after this?",
    ],
  },
];

/** Parse suggested prompts from an HTML comment at the end of assistant text. */
function parseSuggestedPrompts(text: string): string[] {
  const match = text.match(/<!--\s*suggested-prompts\s*\n([\s\S]*?)-->/);
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Strip the suggested-prompts HTML comment from display text. */
function stripSuggestedPrompts(text: string): string {
  return text.replace(/<!--\s*suggested-prompts\s*\n[\s\S]*?-->/, "").trimEnd();
}

function SuggestedPrompts({
  prompts,
  sendMessage,
}: {
  prompts: string[];
  sendMessage: (message: { text: string }) => void;
}) {
  if (prompts.length === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-2 px-5 pb-2">
      {prompts.map((prompt) => (
        <button
          key={prompt}
          type="button"
          className={cn(
            "text-xs text-muted-foreground text-left",
            "hover:text-foreground transition-colors",
            "cursor-pointer",
          )}
          onClick={() => sendMessage({ text: prompt })}
        >
          → {prompt}
        </button>
      ))}
    </div>
  );
}

function ChatEmptyState({
  bookTitle,
  sendMessage,
}: {
  bookTitle: string;
  sendMessage: (message: { text: string }) => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-2">
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

/** Inline SE book card for chat results — compact horizontal layout. */
function ChatSEBookCard({
  book,
  isDownloading,
  isAdded,
  onDownload,
}: {
  book: SEBook;
  isDownloading: boolean;
  isAdded: boolean;
  onDownload: (book: SEBook) => void;
}) {
  return (
    <div className="flex w-36 shrink-0 flex-col overflow-hidden rounded-lg border bg-card transition-shadow hover:shadow-md">
      <div className="aspect-[2/3] w-full overflow-hidden bg-muted">
        {book.coverUrl ? (
          <img
            src={book.coverUrl}
            alt={book.title}
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center p-2 text-center">
            <Globe className="mb-1 size-6 text-muted-foreground/50" />
            <p className="line-clamp-3 text-xs font-medium text-muted-foreground">{book.title}</p>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-1.5">
        <a
          href={`https://standardebooks.org${book.urlPath}`}
          target="_blank"
          rel="noopener noreferrer"
          className="line-clamp-2 text-xs font-medium leading-tight hover:underline"
        >
          {book.title}
        </a>
        <p className="line-clamp-1 text-[11px] text-muted-foreground">{book.author}</p>
        <div className="mt-auto pt-1">
          <Button
            variant={isAdded ? "ghost" : "outline"}
            size="sm"
            className="h-7 w-full text-xs"
            disabled={isDownloading || isAdded}
            onClick={() => onDownload(book)}
          >
            {isDownloading ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                Importing…
              </>
            ) : isAdded ? (
              <>
                <Check className="size-3" />
                Added
              </>
            ) : (
              <>
                <Plus className="size-3" />
                Add to Library
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Renders SE search results as a horizontally scrollable row of cards in chat. */
function SEBookCardsInChat({ books }: { books: SEBook[] }) {
  const { onBookAddedRef } = useWorkspace();
  const [downloadingUrls, setDownloadingUrls] = useState<Set<string>>(new Set());
  const [addedUrls, setAddedUrls] = useState<Set<string>>(new Set());

  const handleDownload = useCallback(
    async (seBook: SEBook) => {
      if (downloadingUrls.has(seBook.urlPath) || addedUrls.has(seBook.urlPath)) return;

      setDownloadingUrls((prev) => new Set(prev).add(seBook.urlPath));

      const program = Effect.gen(function* () {
        const seSvc = yield* StandardEbooksService;
        const arrayBuffer = yield* seSvc.downloadEpub(seBook.urlPath);
        const metadata = yield* parseEpubEffect(arrayBuffer);
        const book: BookMeta = {
          id: crypto.randomUUID(),
          title: metadata.title,
          author: metadata.author,
          coverImage: metadata.coverImage,
        };
        yield* BookService.pipe(Effect.andThen((s) => s.saveBook(book, arrayBuffer)));
        return book;
      });

      try {
        const book = await AppRuntime.runPromise(program);
        setAddedUrls((prev) => new Set(prev).add(seBook.urlPath));
        onBookAddedRef.current?.(book);
      } catch (err) {
        console.error("Failed to import book from chat:", err);
      } finally {
        setDownloadingUrls((prev) => {
          const next = new Set(prev);
          next.delete(seBook.urlPath);
          return next;
        });
      }
    },
    [downloadingUrls, addedUrls, onBookAddedRef],
  );

  if (books.length === 0) return null;

  return (
    <div className="my-2 -mx-1 overflow-x-auto">
      <div className="flex gap-2 px-1 pb-2">
        {books.map((book) => (
          <ChatSEBookCard
            key={book.urlPath}
            book={book}
            isDownloading={downloadingUrls.has(book.urlPath)}
            isAdded={addedUrls.has(book.urlPath)}
            onDownload={handleDownload}
          />
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
  const { waitForNavForBook, findTocForBook, applyTempHighlightForBook } = useWorkspace();

  const textParts =
    message.parts?.filter((p): p is { type: "text"; text: string } => p.type === "text") ?? [];
  const toolParts = message.parts?.filter((p: any) => getToolInfo(p) !== null) ?? [];
  const reasoningParts = message.parts?.filter((p) => p.type === "reasoning") ?? [];

  const rawText = textParts.map((p) => p.text).join("");
  const text = isUser ? rawText : stripSuggestedPrompts(rawText);
  const hasProcessSteps = toolParts.length > 0 || reasoningParts.length > 0;

  // Extract SE book results from search_standard_ebooks tool parts
  const seBooks = useMemo(() => {
    const results: SEBook[] = [];
    for (const part of toolParts) {
      const info = getToolInfo(part);
      if (
        info &&
        info.toolName === "search_standard_ebooks" &&
        info.state === "output-available" &&
        info.output?.books &&
        Array.isArray(info.output.books)
      ) {
        for (const b of info.output.books) {
          if (b.title && b.urlPath) {
            results.push({
              title: b.title,
              author: b.author ?? "",
              urlPath: b.urlPath,
              coverUrl: b.coverUrl ?? null,
            });
          }
        }
      }
    }
    return results.slice(0, 4);
  }, [toolParts]);

  const streamdownComponents = useMemo<Components>(
    () => ({
      ref: ({ children, chapter, query }: Record<string, unknown>) => {
        const queryStr = typeof query === "string" ? query : "";
        if (!queryStr) {
          // No query — render as plain text
          return <span>{children as React.ReactNode}</span>;
        }

        const chapterStr = typeof chapter === "string" ? chapter : "";

        const handleClick = async () => {
          console.debug("[ChatPanel] handleClick", { bookId });
          const data = bookDataRef.current;
          if (!data) {
            console.warn("Ref navigation: no book data available");
            return;
          }

          const navigate = await waitForNavForBook(bookId);
          if (!navigate) {
            console.warn("Ref navigation: no navigate callback for book", bookId);
            return;
          }

          try {
            const ePub = (await import("epubjs")).default;
            const { fuzzySearchBookForCfi } = await import("~/lib/epub-search");
            const book = ePub(data.slice(0));
            try {
              const results = await fuzzySearchBookForCfi(book, queryStr);

              if (results.length > 0) {
                const cfi = results[0].cfi;
                navigate(cfi);
                applyTempHighlightForBook(bookId, cfi);
                return;
              }
            } finally {
              book.destroy();
            }

            // Fallback: navigate to chapter start via TOC
            if (chapterStr) {
              const chapterIndex = parseInt(chapterStr, 10);
              if (!isNaN(chapterIndex)) {
                const toc = findTocForBook(bookId);
                if (toc && toc[chapterIndex]) {
                  console.debug("Ref navigation: falling back to chapter", chapterIndex);
                  navigate(toc[chapterIndex].href);
                  return;
                }
              }
            }

            console.debug("Ref navigation: no results for query:", queryStr);
          } catch (err) {
            console.warn("Ref navigation failed:", err);
          }
        };

        return (
          <span
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") handleClick();
            }}
            className="underline decoration-dotted underline-offset-2 cursor-pointer hover:decoration-solid transition-all inline"
            title={`Go to: "${queryStr}"`}
          >
            {children as React.ReactNode}
          </span>
        );
      },
    }),
    [bookId, bookDataRef, waitForNavForBook, findTocForBook, applyTempHighlightForBook],
  );

  return (
    <div
      className={cn("flex px-5", {
        "justify-end": isUser,
        "justify-start": !isUser,
      })}
    >
      <div
        className={cn("max-w-prose text-sm", {
          "rounded-lg px-3 py-2 bg-secondary text-secondary-foreground my-5": isUser,
          "text-foreground": !isUser,
        })}
      >
        {hasProcessSteps && (
          <details className="group mb-5 -ml-4" open={isStreaming || undefined}>
            <summary className="cursor-pointer text-[11px] text-muted-foreground font-mono flex items-center gap-1 list-none [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
              {toolParts
                .map((part) => {
                  const info = getToolInfo(part);
                  if (!info) return null;
                  if (info.toolName === "search_book") return "Searched book";
                  if (info.toolName === "read_chapter") return "Read chapter";
                  if (info.toolName === "read_notes") return "Read notebook";
                  if (info.toolName === "append_to_notes") return "Added to notebook";
                  if (info.toolName === "create_highlight") return "Highlighted";
                  if (info.toolName === "search_standard_ebooks") return "Searched Standard Ebooks";
                  return info.toolName;
                })
                .filter(Boolean)
                .join(", ")}
              {toolParts.length > 0 &&
                ` → ${toolParts.length} step${toolParts.length > 1 ? "s" : ""}`}
              {reasoningParts.length > 0 && toolParts.length === 0 && "Reasoning"}
            </summary>
            <div
              className={cn("mt-1 space-y-0.5 pl-4 text-[11px] font-mono text-muted-foreground", {
                "max-h-[4.5rem] overflow-y-auto": isStreaming,
              })}
            >
              {toolParts.map((part, i) => {
                const info = getToolInfo(part);
                if (!info) return null;
                const isComplete = info.state === "output-available";
                let label = info.toolName;
                if (info.toolName === "search_book") {
                  const query = typeof info.input?.query === "string" ? info.input.query : "";
                  if (isComplete && Array.isArray(info.output)) {
                    label = `Searched for "${query}" → ${info.output.length} result${info.output.length !== 1 ? "s" : ""}`;
                  } else {
                    label = `Searching for "${query}"...`;
                  }
                } else if (info.toolName === "read_chapter") {
                  const title = info.input?.chapterTitle
                    ? String(info.input.chapterTitle)
                    : `chapter ${info.input?.chapterIndex}`;
                  if (isComplete && (info.output as any)?.text) {
                    label = `Read ${title} → ${(info.output as any).text.length.toLocaleString()} chars`;
                  } else {
                    label = `Reading ${title}...`;
                  }
                } else if (info.toolName === "read_notes") {
                  label = isComplete ? "Read notebook" : "Reading notebook...";
                } else if (info.toolName === "append_to_notes") {
                  label = isComplete ? "Added to notebook" : "Adding to notebook...";
                } else if (info.toolName === "create_highlight") {
                  const snippet =
                    typeof info.input?.text === "string"
                      ? (info.input.text as string).slice(0, 30) +
                        ((info.input.text as string).length > 30 ? "…" : "")
                      : "";
                  label = isComplete
                    ? `Highlighted: "${snippet}"`
                    : `Highlighting: "${snippet}"...`;
                } else if (info.toolName === "search_standard_ebooks") {
                  const q = typeof info.input?.query === "string" ? info.input.query : "";
                  if (isComplete && info.output?.books) {
                    label = `Searched Standard Ebooks for "${q}" → ${(info.output.books as any[]).length} result${(info.output.books as any[]).length !== 1 ? "s" : ""}`;
                  } else {
                    label = `Searching Standard Ebooks for "${q}"...`;
                  }
                }
                return (
                  <div key={i} className="flex items-center gap-1.5 leading-tight">
                    {isComplete ? (
                      <span className="size-1 rounded-full bg-muted-foreground/50 shrink-0" />
                    ) : (
                      <span className="size-1.5 rounded-full bg-muted-foreground/70 animate-pulse shrink-0" />
                    )}
                    {label}
                  </div>
                );
              })}
              {reasoningParts.map((part, i) => (
                <div key={`r-${i}`} className="italic leading-tight">
                  {(part as any).text}
                </div>
              ))}
            </div>
          </details>
        )}
        {seBooks.length > 0 && <SEBookCardsInChat books={seBooks} />}
        {text &&
          (isUser ? (
            <p className="whitespace-pre-wrap">{text}</p>
          ) : (
            <Streamdown
              caret="circle"
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
