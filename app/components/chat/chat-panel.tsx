import { useCallback, useEffect, useRef, useState } from "react";
import type { UIMessage } from "@ai-sdk/react";
import { Effect } from "effect";
import { Button } from "~/components/ui/button";
import { OnboardingDialog } from "~/components/onboarding/onboarding-dialog";
import { useSyncListener } from "~/hooks/use-sync-listener";
import { useAuth } from "~/lib/context/auth-context";
import { AppRuntime } from "~/lib/effect-runtime";
import { extractBookChapters, type BookChapter } from "~/lib/epub/epub-text-extract";
import { DEMO_BOOK_ID, DEMO_CHAT_SESSION } from "~/lib/onboarding/demo-content";
import { extractPdfChapters } from "~/lib/pdf/pdf-text-extract";
import { BookService } from "~/lib/stores/book-store";
import { ChatService } from "~/lib/stores/chat-store";
import { ensureBookChaptersUploaded } from "~/lib/sync/book-chapter-uploads";
import { ChatPanelInner } from "./chat-panel-inner";
import { resolvePendingChatMessage, type ChatIntent } from "./chat-intent";
import { toUIMessages, uiMessagesToChatMessages } from "./chat-utils";

interface ChatPanelProps {
  bookId: string;
  bookTitle: string;
}

function lastMessageSignature(message: UIMessage | undefined): string {
  if (!message) return "";
  const parts = message.parts ?? [];
  let signature = `${message.id}|${parts.length}`;
  for (const part of parts) {
    if (part.type === "text") {
      signature += `|t:${part.text.length}`;
    } else if (part.type.startsWith("tool-")) {
      const toolPart = part as { state?: string; output?: unknown };
      signature += `|${part.type}:${toolPart.state ?? ""}:${toolPart.output === undefined ? 0 : 1}`;
    } else {
      signature += `|${part.type}`;
    }
  }
  return signature;
}

function messagesDiffer(current: UIMessage[], next: UIMessage[]): boolean {
  if (current.length !== next.length) return true;
  if (current.length === 0) return false;
  const currentLast = current[current.length - 1];
  const nextLast = next[next.length - 1];
  return (
    currentLast.id !== nextLast.id ||
    lastMessageSignature(currentLast) !== lastMessageSignature(nextLast)
  );
}

export function ChatPanel({ bookId, bookTitle }: ChatPanelProps) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(null);
  const [bookContext, setBookContext] = useState<{
    title: string;
    author: string;
    chapters: BookChapter[];
  } | null>(null);
  const [bookFormat, setBookFormat] = useState<string>();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState("");
  const [sessionKey, setSessionKey] = useState(0);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [pendingChatIntent, setPendingChatIntent] = useState<ChatIntent>({ type: "none" });
  const [resumeAfterAuth, setResumeAfterAuth] = useState(false);
  const bookDataRef = useRef<ArrayBuffer | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef("");
  const setChatMessagesRef = useRef<((messages: UIMessage[]) => void) | null>(null);

  useEffect(() => {
    if (!isAuthenticated && bookId !== DEMO_BOOK_ID) return;
    let cancelled = false;

    const load = async () => {
      try {
        const book = await AppRuntime.runPromise(
          BookService.pipe(
            Effect.andThen((service) => service.getBook(bookId)),
            Effect.catchTag("BookNotFoundError", () => Effect.succeed(null)),
          ),
        );
        if (cancelled) return;
        if (!book) {
          setLoadError(
            "Book not found. This chat panel may have been restored from a saved layout for a deleted book.",
          );
          return;
        }

        const [savedMessages, bookData] = await Promise.all([
          AppRuntime.runPromise(
            ChatService.pipe(Effect.andThen((service) => service.getMessages(bookId))),
          ),
          AppRuntime.runPromise(
            BookService.pipe(Effect.andThen((service) => service.getBookData(bookId))),
          ),
        ]);
        if (cancelled) return;

        const activeId = await AppRuntime.runPromise(
          ChatService.pipe(Effect.andThen((service) => service.getActiveSessionId(bookId))),
        );
        if (cancelled) return;
        if (activeId) {
          setActiveSessionId(activeId);
          const session = await AppRuntime.runPromise(
            ChatService.pipe(Effect.andThen((service) => service.getSession(activeId, bookId))),
          );
          if (cancelled) return;
          if (session) setSessionTitle(session.title);
        } else if (isAuthenticated) {
          const session = await AppRuntime.runPromise(
            ChatService.pipe(Effect.andThen((service) => service.createSession(bookId))),
          );
          if (cancelled) return;
          setActiveSessionId(session.id);
          setSessionTitle(session.title);
        }

        let chapters: BookChapter[] = [];
        try {
          chapters =
            book.format === "pdf"
              ? await extractPdfChapters(bookData)
              : await extractBookChapters(bookData);
        } catch (error) {
          console.warn("Failed to extract book chapters for chat context:", error);
        }
        if (cancelled) return;

        bookDataRef.current = bookData;
        setBookFormat(book.format);
        if (isAuthenticated && chapters.length > 0) {
          try {
            await ensureBookChaptersUploaded(bookId, { chapters, format: book.format });
          } catch (error) {
            console.error("Failed to upload chapters for chat context:", error);
          }
        }
        if (cancelled) return;

        setBookContext({ title: book.title, author: book.author, chapters });
        setInitialMessages(toUIMessages(savedMessages));
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load chat data:", error);
          setLoadError("Failed to load chat data.");
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [bookId, isAuthenticated]);

  const initialMessagesRef = useRef(initialMessages);
  initialMessagesRef.current = initialMessages;

  useEffect(() => {
    if (!isAuthenticated || !activeSessionId) return;
    let cancelled = false;
    fetch(`/api/chat/messages/${encodeURIComponent(activeSessionId)}`)
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as {
          messages: UIMessage[];
          activeStreamId: string | null;
        };
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
        AppRuntime.runPromise(
          ChatService.pipe(
            Effect.andThen((service) =>
              service.cacheServerMessages(
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

  const sessionSyncVersion = useSyncListener(["chat_session"]);
  const messageSyncVersion = useSyncListener(["chat_message"]);

  useEffect(() => {
    if (sessionSyncVersion === 0 || !activeSessionId) return;
    AppRuntime.runPromise(
      ChatService.pipe(Effect.andThen((service) => service.getSession(activeSessionId, bookId))),
    )
      .then((session) => {
        if (session) setSessionTitle(session.title);
      })
      .catch(console.error);
  }, [bookId, activeSessionId, sessionSyncVersion]);

  useEffect(() => {
    if (messageSyncVersion === 0 || !activeSessionId) return;
    AppRuntime.runPromise(
      ChatService.pipe(Effect.andThen((service) => service.getSession(activeSessionId, bookId))),
    )
      .then((session) => {
        if (!session) return;
        const newMessages = toUIMessages(session.messages);
        const currentMessages = initialMessagesRef.current ?? [];
        if (!messagesDiffer(currentMessages, newMessages)) return;
        if (setChatMessagesRef.current) {
          setChatMessagesRef.current(newMessages);
          initialMessagesRef.current = newMessages;
        } else {
          setInitialMessages(newMessages);
          setSessionKey((key) => key + 1);
        }
      })
      .catch(console.error);
  }, [bookId, activeSessionId, messageSyncVersion]);

  const handleSwitchSession = useCallback(
    async (sessionId: string) => {
      await AppRuntime.runPromise(
        ChatService.pipe(
          Effect.andThen((service) => service.setActiveSessionId(bookId, sessionId)),
        ),
      );
      const session = await AppRuntime.runPromise(
        ChatService.pipe(Effect.andThen((service) => service.getSession(sessionId, bookId))),
      );
      if (!session) return;
      setActiveSessionId(sessionId);
      setSessionTitle(session.title);
      setInitialMessages(toUIMessages(session.messages));
      setSessionKey((key) => key + 1);
    },
    [bookId],
  );

  const handleNewSession = useCallback(async () => {
    const session = await AppRuntime.runPromise(
      ChatService.pipe(Effect.andThen((service) => service.createSession(bookId))),
    );
    setActiveSessionId(session.id);
    setSessionTitle(session.title);
    setInitialMessages([]);
    setSessionKey((key) => key + 1);
  }, [bookId]);

  const openOnboarding = useCallback((intent: ChatIntent) => {
    setPendingChatIntent(intent);
    setResumeAfterAuth(false);
    setOnboardingOpen(true);
  }, []);
  const handleOnboardingOpenChange = useCallback((open: boolean) => {
    setOnboardingOpen(open);
    if (!open) {
      setPendingChatIntent({ type: "none" });
      setResumeAfterAuth(false);
    }
  }, []);
  const handleAuthenticated = useCallback(() => {
    const typedText = textareaRef.current?.value.trim();
    if (typedText) {
      setPendingChatIntent((intent) =>
        resolvePendingChatMessage(intent) ? intent : { type: "typed", text: typedText },
      );
    }
    setResumeAfterAuth(true);
    setOnboardingOpen(false);
  }, []);
  const handleResumeComplete = useCallback(() => {
    setPendingChatIntent({ type: "none" });
    setResumeAfterAuth(false);
  }, []);
  const isLoggedOutDemoBook = !isAuthenticated && bookId === DEMO_BOOK_ID;
  const isLoggedOutDemoSession = isLoggedOutDemoBook && activeSessionId === DEMO_CHAT_SESSION.id;
  const pendingMessage = resolvePendingChatMessage(pendingChatIntent);

  useEffect(() => {
    if (isAuthenticated && resumeAfterAuth && pendingMessage === null) handleResumeComplete();
  }, [handleResumeComplete, isAuthenticated, pendingMessage, resumeAfterAuth]);

  if (authLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!isAuthenticated && !isLoggedOutDemoBook) {
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

  if (!initialMessages || !bookContext || (isAuthenticated && !activeSessionId)) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading chat…</p>
      </div>
    );
  }

  if (!isAuthenticated && !isLoggedOutDemoSession) {
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

  if (!activeSessionId) return null;

  return (
    <>
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
        onRegisterSetMessages={(setMessages) => {
          setChatMessagesRef.current = setMessages;
        }}
        onChatInteraction={isLoggedOutDemoSession ? openOnboarding : undefined}
        resumeMessage={
          isAuthenticated && resumeAfterAuth ? (pendingMessage ?? undefined) : undefined
        }
        onResumeComplete={handleResumeComplete}
      />
      {isLoggedOutDemoSession && (
        <OnboardingDialog
          open={onboardingOpen}
          onOpenChange={handleOnboardingOpenChange}
          onAuthenticated={handleAuthenticated}
        />
      )}
    </>
  );
}
