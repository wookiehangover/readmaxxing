import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { Effect } from "effect";
import { useStickToBottom } from "use-stick-to-bottom";
import { Button } from "~/components/ui/button";
import { Plus } from "lucide-react";
import { ChatService } from "~/lib/stores/chat-store";
import { BookService } from "~/lib/stores/book-store";
import { AnnotationService } from "~/lib/stores/annotations-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { tiptapJsonToMarkdown } from "~/lib/editor/tiptap-to-markdown";
import { extractBookChapters, type BookChapter } from "~/lib/epub/epub-text-extract";
import { extractPdfChapters } from "~/lib/pdf/pdf-text-extract";
import { cn } from "~/lib/utils";
import { useWorkspace } from "~/lib/context/workspace-context";
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
import { SessionMenuButton, ChatSessionList, EditableTitle } from "./chat-session-menu";

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
  const [bookFormat, setBookFormat] = useState<string | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string>("");
  // Increment to force ChatPanelInner remount on session switch
  const [sessionKey, setSessionKey] = useState(0);
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

        // Get active session info
        const activeId = await AppRuntime.runPromise(
          ChatService.pipe(Effect.andThen((s) => s.getActiveSessionId(bookId))),
        );
        if (cancelled) return;

        if (activeId) {
          setActiveSessionId(activeId);
          const session = await AppRuntime.runPromise(
            ChatService.pipe(Effect.andThen((s) => s.getSession(activeId, bookId))),
          );
          if (cancelled) return;
          if (session) {
            setSessionTitle(session.title);
          }
        } else {
          // No session exists — create one so messages persist from the start
          const newSession = await AppRuntime.runPromise(
            ChatService.pipe(Effect.andThen((s) => s.createSession(bookId))),
          );
          if (cancelled) return;
          setActiveSessionId(newSession.id);
          setSessionTitle(newSession.title);
        }

        const chapters =
          book.format === "pdf"
            ? await extractPdfChapters(bookData)
            : await extractBookChapters(bookData);
        if (cancelled) return;

        bookDataRef.current = bookData;
        setBookFormat(book.format);
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

  const handleSwitchSession = useCallback(
    async (sessionId: string) => {
      await AppRuntime.runPromise(
        ChatService.pipe(Effect.andThen((s) => s.setActiveSessionId(bookId, sessionId))),
      );
      const session = await AppRuntime.runPromise(
        ChatService.pipe(Effect.andThen((s) => s.getSession(sessionId, bookId))),
      );
      if (session) {
        setActiveSessionId(sessionId);
        setSessionTitle(session.title);
        setInitialMessages(toUIMessages(session.messages));
        setSessionKey((k) => k + 1);
      }
    },
    [bookId],
  );

  const handleNewSession = useCallback(async () => {
    const session = await AppRuntime.runPromise(
      ChatService.pipe(Effect.andThen((s) => s.createSession(bookId))),
    );
    setActiveSessionId(session.id);
    setSessionTitle(session.title);
    setInitialMessages([]);
    setSessionKey((k) => k + 1);
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
      key={sessionKey}
      bookId={bookId}
      bookTitle={bookTitle}
      bookFormat={bookFormat}
      initialMessages={initialMessages}
      bookContext={bookContext}
      bookDataRef={bookDataRef}
      textareaRef={textareaRef}
      inputRef={inputRef}
      activeSessionId={activeSessionId}
      sessionTitle={sessionTitle}
      onSwitchSession={handleSwitchSession}
      onNewSession={handleNewSession}
      onSessionTitleChange={setSessionTitle}
    />
  );
}

function ChatPanelInner({
  bookId,
  bookTitle,
  bookFormat,
  initialMessages,
  bookContext,
  bookDataRef,
  textareaRef,
  inputRef,
  activeSessionId,
  sessionTitle,
  onSwitchSession,
  onNewSession,
  onSessionTitleChange,
}: {
  bookId: string;
  bookTitle: string;
  bookFormat?: string;
  initialMessages: UIMessage[];
  bookContext: { title: string; author: string; chapters: BookChapter[] };
  bookDataRef: React.RefObject<ArrayBuffer | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  inputRef: React.MutableRefObject<string>;
  activeSessionId: string | null;
  sessionTitle: string;
  onSwitchSession: (sessionId: string) => void;
  onNewSession: () => void;
  onSessionTitleChange: (title: string) => void;
}) {
  const { chatContextMap } = useWorkspace();
  const [showSessionList, setShowSessionList] = useState(false);

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
    if (!activeSessionId) return;
    const current = messagesRef.current;
    const sid = activeSessionId;
    AppRuntime.runPromise(
      Effect.gen(function* () {
        const svc = yield* ChatService;
        const session = yield* svc.getSession(sid, bookId);
        if (!session) return;
        yield* svc.saveSession({ ...session, messages: toChatMessages(current) });
      }),
    ).catch(console.error);
  }, [bookId, activeSessionId]);

  const { onFinish: onToolFinish } = useChatToolHandlers({
    bookId,
    bookFormat,
    bookDataRef,
    persistMessages,
    setNotebookMarkdown,
  });

  // Track whether title generation has already been triggered for this session
  const titleGeneratedRef = useRef(false);

  const onFinish = useCallback(
    (event: { message: UIMessage }) => {
      onToolFinish(event);

      // Fire-and-forget title generation after the first assistant response
      const currentMessages = messagesRef.current;
      if (
        !titleGeneratedRef.current &&
        event.message.role === "assistant" &&
        currentMessages.length <= 5
      ) {
        titleGeneratedRef.current = true;

        // Check if the active session needs a title, then generate one
        const generateTitle = async () => {
          const session = await AppRuntime.runPromise(
            Effect.gen(function* () {
              const svc = yield* ChatService;
              const activeId = yield* svc.getActiveSessionId(bookId);
              if (!activeId) return null;
              return yield* svc.getSession(activeId, bookId);
            }),
          );

          if (!session) return;

          // Only generate if session has a default/generic title
          if (session.title) return;

          const res = await fetch("/api/chat-title", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: currentMessages }),
          });

          if (!res.ok) return;

          const { title } = (await res.json()) as { title: string };
          if (!title) return;

          await AppRuntime.runPromise(
            ChatService.pipe(
              Effect.andThen((svc) => svc.updateSessionTitle(session.id, session.bookId, title)),
            ),
          );
          onSessionTitleChange(title);
        };

        generateTitle().catch(console.error);
      }
    },
    [onToolFinish, bookId, onSessionTitleChange],
  );

  const { messages, sendMessage, status, stop } = useChat({
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

  const { scrollRef, contentRef } = useStickToBottom();

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

  const handleSwitchSessionFromList = useCallback(
    (sessionId: string) => {
      setShowSessionList(false);
      if (sessionId !== activeSessionId) {
        onSwitchSession(sessionId);
      }
    },
    [activeSessionId, onSwitchSession],
  );

  const handleNewSessionFromList = useCallback(() => {
    setShowSessionList(false);
    onNewSession();
  }, [onNewSession]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <SessionMenuButton
          showSessionList={showSessionList}
          onToggle={() => setShowSessionList((v) => !v)}
        />
        {showSessionList ? (
          <h3 className="min-w-0 flex-1 truncate text-sm font-medium">Sessions</h3>
        ) : sessionTitle ? (
          <EditableTitle
            value={sessionTitle}
            className="min-w-0 flex-1 text-sm font-medium"
            onSave={(newTitle) => {
              if (!activeSessionId) return;
              AppRuntime.runPromise(
                ChatService.pipe(
                  Effect.andThen((s) => s.updateSessionTitle(activeSessionId, bookId, newTitle)),
                ),
              )
                .then(() => onSessionTitleChange(newTitle))
                .catch(console.error);
            }}
          />
        ) : null}
        {!showSessionList && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onNewSession}
            title="New chat"
            className="size-7 ml-auto"
          >
            <Plus className="size-3.5" />
            <span className="sr-only">New chat</span>
          </Button>
        )}
      </div>

      {showSessionList ? (
        <ChatSessionList
          bookId={bookId}
          activeSessionId={activeSessionId}
          onSwitchSession={handleSwitchSessionFromList}
          onNewSession={handleNewSessionFromList}
          onClose={() => setShowSessionList(false)}
        />
      ) : (
        <>
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
                        bookFormat={bookFormat}
                        bookDataRef={bookDataRef}
                        isStreaming={isCurrentlyStreaming}
                      />
                      {isLastAssistant && !isLoading && (
                        <SuggestedPrompts
                          prompts={parseSuggestedPrompts(
                            message.parts
                              ?.filter(
                                (p): p is { type: "text"; text: string } => p.type === "text",
                              )
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
          </div>

          {/* Input */}
          <ChatInput
            textareaRef={textareaRef}
            inputRef={inputRef}
            isLoading={isLoading}
            onSubmit={handleSubmit}
            onStop={stop}
          />
        </>
      )}
    </div>
  );
}
