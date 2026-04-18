import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { Effect } from "effect";
import { useStickToBottom } from "use-stick-to-bottom";
import { Button } from "~/components/ui/button";
import { Plus } from "lucide-react";
import { ChatService } from "~/lib/stores/chat-store";
import { BookService } from "~/lib/stores/book-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { extractBookChapters, type BookChapter } from "~/lib/epub/epub-text-extract";
import { extractPdfChapters } from "~/lib/pdf/pdf-text-extract";
import { isChaptersUploaded, markChaptersUploaded } from "~/lib/stores/chapter-upload-cache-store";
import { cn } from "~/lib/utils";
import { useSyncListener } from "~/hooks/use-sync-listener";
import { useWorkspace } from "~/lib/context/workspace-context";
import { useAuth } from "~/lib/context/auth-context";
import {
  toUIMessages,
  uiMessagesToChatMessages,
  parseSuggestedPrompts,
  createChatTransport,
} from "./chat-utils";
import { ChatMessage } from "./chat-message";
import { ChatEmptyState, SuggestedPrompts } from "./chat-empty-state";
import { useChatToolHandlers } from "./use-chat-tool-handlers";
import { useStreamingAppend } from "./use-streaming-append";
import { ChatInput } from "./chat-input";
import { SessionMenuButton, ChatSessionList, EditableTitle } from "./chat-session-menu";

interface ChatPanelProps {
  bookId: string;
  bookTitle: string;
}

async function uploadChaptersOnce(
  bookId: string,
  chapters: BookChapter[],
  format: string | undefined,
): Promise<void> {
  if (await isChaptersUploaded(bookId)) return;
  const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/chapters`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chapters, format }),
  });
  if (res.ok) {
    await markChaptersUploaded(bookId);
    return;
  }
  // 401 (signed out) / 503 (sync off) are expected — don't mark, try again next open
  if (res.status !== 401 && res.status !== 503) {
    console.error("Failed to upload chapters:", res.status, await res.text().catch(() => ""));
  }
}

export function ChatPanel({ bookId, bookTitle }: ChatPanelProps) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
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
  // Ref to setMessages from ChatPanelInner's useChat hook — lets us update
  // messages in-place on sync without remounting (which loses scroll position).
  const setChatMessagesRef = useRef<((msgs: UIMessage[]) => void) | null>(null);

  // Load chat history and book context on mount.
  //
  // Gated on `isAuthenticated` so signed-out users never create orphaned local
  // chat sessions (these would otherwise linger in IDB until the next manual
  // clear) and never fire the subsequent messages fetch that would 401.
  useEffect(() => {
    if (!isAuthenticated) return;
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

        // Fire-and-forget: upload chapters to the server once per book so
        // subsequent chat requests can reuse the cached text.
        uploadChaptersOnce(bookId, chapters, book.format).catch(console.error);
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
  }, [bookId, isAuthenticated]);

  // Track current messages for sync comparison without re-registering the listener
  const initialMessagesRef = useRef(initialMessages);
  initialMessagesRef.current = initialMessages;

  // Reconcile with the server-authoritative message history whenever the
  // active session changes. IDB is rendered first as a warm-start cache; the
  // fetched messages then replace it via the registered setMessages callback
  // AND are written back to IDB so the next cold reload renders the correct
  // thread immediately (instead of the stale pre-server IDB copy).
  //
  // If the server is unavailable (401/503), we silently keep the IDB copy.
  // Gated on `isAuthenticated` — signed-out users never hit the endpoint.
  //
  // Session-switch safety: `handleSwitchSession` bumps `sessionKey` which
  // remounts ChatPanelInner. The `cancelled` flag below is flipped during
  // cleanup before the next effect runs, so any in-flight fetch for the old
  // session bails out before touching the new inner's `setChatMessagesRef`.
  useEffect(() => {
    if (!isAuthenticated || !activeSessionId) return;
    let cancelled = false;
    fetch(`/api/chat/messages/${encodeURIComponent(activeSessionId)}`)
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as { messages: UIMessage[]; activeStreamId: string | null };
      })
      .then((data) => {
        if (cancelled || !data) return;
        const serverMessages = data.messages;
        if (setChatMessagesRef.current) {
          setChatMessagesRef.current(serverMessages);
          initialMessagesRef.current = serverMessages;
        } else {
          setInitialMessages(serverMessages);
          initialMessagesRef.current = serverMessages;
        }
        // Cache the server result locally so a subsequent cold reload sees
        // the authoritative thread even before the fetch completes.
        AppRuntime.runPromise(
          ChatService.pipe(
            Effect.andThen((s) =>
              s.cacheServerMessages(
                bookId,
                activeSessionId,
                uiMessagesToChatMessages(serverMessages),
              ),
            ),
          ),
        ).catch(console.error);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [bookId, activeSessionId, isAuthenticated]);

  // Reload chat messages when sync pulls chat data from server
  const chatSyncVersion = useSyncListener(["chat_session", "chat_message"]);
  useEffect(() => {
    if (chatSyncVersion === 0 || !activeSessionId) return;
    AppRuntime.runPromise(
      ChatService.pipe(Effect.andThen((s) => s.getSession(activeSessionId, bookId))),
    )
      .then((session) => {
        if (!session) return;
        const newMessages = toUIMessages(session.messages);
        const currentLast = initialMessagesRef.current?.[initialMessagesRef.current.length - 1];
        const newLast = newMessages[newMessages.length - 1];
        // Only update if the last message actually changed
        if (currentLast?.id !== newLast?.id) {
          setSessionTitle(session.title);
          if (setChatMessagesRef.current) {
            // Update messages in-place without remounting — preserves scroll
            setChatMessagesRef.current(newMessages);
            initialMessagesRef.current = newMessages;
          } else {
            // Fallback: remount if ref isn't registered yet
            setInitialMessages(newMessages);
            setSessionKey((k) => k + 1);
          }
        }
      })
      .catch(console.error);
  }, [bookId, activeSessionId, chatSyncVersion]);

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

  // Show loading state while checking auth
  if (authLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  // Show sign-in CTA if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-4">
        <p className="text-center text-muted-foreground">
          Sign in to chat with <span className="italic">{bookTitle}</span>
        </p>
        <Button render={<a href="/login" />} nativeButton={false} variant="default">
          Sign in
        </Button>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">{loadError}</p>
      </div>
    );
  }

  if (!initialMessages || !bookContext || !activeSessionId) {
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
      bookDataRef={bookDataRef}
      textareaRef={textareaRef}
      inputRef={inputRef}
      activeSessionId={activeSessionId}
      sessionTitle={sessionTitle}
      onSwitchSession={handleSwitchSession}
      onNewSession={handleNewSession}
      onSessionTitleChange={setSessionTitle}
      onRegisterSetMessages={(fn) => {
        setChatMessagesRef.current = fn;
      }}
    />
  );
}

function ChatPanelInner({
  bookId,
  bookTitle,
  bookFormat,
  initialMessages,
  bookDataRef,
  textareaRef,
  inputRef,
  activeSessionId,
  sessionTitle,
  onSwitchSession,
  onNewSession,
  onSessionTitleChange,
  onRegisterSetMessages,
}: {
  bookId: string;
  bookTitle: string;
  bookFormat?: string;
  initialMessages: UIMessage[];
  bookDataRef: React.RefObject<ArrayBuffer | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  inputRef: React.MutableRefObject<string>;
  activeSessionId: string;
  sessionTitle: string;
  onSwitchSession: (sessionId: string) => void;
  onNewSession: () => void;
  onSessionTitleChange: (title: string) => void;
  onRegisterSetMessages?: (fn: (msgs: UIMessage[]) => void) => void;
}) {
  const { chatContextMap, notebookEditorCallbackMap } = useWorkspace();
  const [showSessionList, setShowSessionList] = useState(false);

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
      createChatTransport({
        sessionId: activeSessionId,
        bookId,
        visibleTextRef,
        currentChapterRef,
      }),
    [activeSessionId, bookId],
  );

  // Track latest messages for onFinish callbacks (e.g. title generation)
  const messagesRef = useRef<UIMessage[]>(initialMessages);

  // Shared ref so the streaming preview hook can tell onFinish which
  // toolCallIds already had their content inserted into the live editor.
  const streamedToolCallIdRef = useRef<Set<string>>(new Set());

  const { onToolCall, onFinish: onToolFinish } = useChatToolHandlers({
    bookId,
    bookFormat,
    bookDataRef,
    streamedToolCallIdRef,
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

  const { messages, sendMessage, setMessages, status, stop } = useChat({
    id: activeSessionId,
    transport,
    messages: initialMessages,
    // Reconnect to any in-flight stream for this session on mount. The resume
    // endpoint returns 204 No Content when nothing is active; `useChat`
    // treats that as a no-op, so this is safe to always enable.
    resume: true,
    // `onToolCall` is a documented no-op placeholder (no client-side tools
    // today). All notebook/highlight tools run on the server; their outputs
    // are consumed in `onFinish`. The cast preserves the SDK callback shape.
    onToolCall: onToolCall as any,
    onFinish,
    onError: (err) => {
      console.error("Chat error:", err);
    },
  });

  // Keep messagesRef in sync
  messagesRef.current = messages;

  // Expose setMessages to the parent so sync can update messages in-place
  useEffect(() => {
    onRegisterSetMessages?.(setMessages);
  }, [setMessages, onRegisterSetMessages]);

  // Stream append_to_notes content to the notebook in real-time as tokens arrive
  useStreamingAppend({
    messages,
    bookId,
    status,
    notebookEditorCallbackMap,
    streamedToolCallIdRef,
  });

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
              "scroll-fog-bottom": messages.length > 0,
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
