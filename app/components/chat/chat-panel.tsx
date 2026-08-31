import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UIMessage } from "@ai-sdk/react";
import { Button } from "~/components/ui/button";
import { OnboardingDialog } from "~/components/onboarding/onboarding-dialog";
import { useSyncListener } from "~/hooks/use-sync-listener";
import { useAuth } from "~/lib/context/auth-context";
import { useWorkspace } from "~/lib/context/workspace-context";
import { extractBookChapters, type BookChapter } from "~/lib/epub/epub-text-extract";
import { DEMO_BOOK_ID, DEMO_CHAT_SESSION } from "~/lib/onboarding/demo-content";
import { extractPdfChapters } from "~/lib/pdf/pdf-text-extract";
import { BookService } from "~/lib/stores/book-store";
import { ensureBookChaptersUploaded } from "~/lib/sync/book-chapter-uploads";
import { adoptDemoBookRequested } from "~/lib/themis/books/books-slice";
import {
  cacheChatMessagesRequested,
  createChatSessionRequested,
  hydrateChatSessionsRequested,
  selectChatSessionRequested,
} from "~/lib/themis/chat-sessions/chat-sessions-slice";
import { useAppStore } from "~/lib/themis/provider";
import { ChatPanelInner } from "./chat-panel-inner";
import { resolvePendingChatMessage, type ChatIntent } from "./chat-intent";
import { toUIMessages, uiMessagesToChatMessages } from "./chat-utils";
import { useRemappedBookId } from "./use-remapped-book-id";

interface ChatPanelProps {
  bookId: string;
  bookTitle: string;
  isVisible?: boolean;
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

export function ChatPanel({ bookId, bookTitle, isVisible = true }: ChatPanelProps) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { pendingChatPromptMap } = useWorkspace();
  const store = useAppStore();
  const [bookContext, setBookContext] = useState<{
    title: string;
    author: string;
    chapters: BookChapter[];
  } | null>(null);
  const [bookFormat, setBookFormat] = useState<string>();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [pendingChatIntent, setPendingChatIntent] = useState<ChatIntent>({ type: "none" });
  const [resumeAfterAuth, setResumeAfterAuth] = useState(false);
  const [explainPrompt, setExplainPrompt] = useState<string | null>(null);
  const [adoptedBookId, setAdoptedBookId] = useState<string | null>(null);
  const [adoptionError, setAdoptionError] = useState<string | null>(null);
  const bookDataRef = useRef<ArrayBuffer | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef("");
  const setChatMessagesRef = useRef<((messages: UIMessage[]) => void) | null>(null);
  const explanationInFlightRef = useRef<{ bookId: string; message: string } | null>(null);

  const chatBookId = useRemappedBookId(adoptedBookId ?? bookId);
  const activeSession = store.chatSessionsSelectors.selectActiveSessionByBook.useValue(chatBookId);
  const activeSessionId = activeSession?.id ?? null;
  const hasReservedChatIds =
    chatBookId === DEMO_BOOK_ID || activeSessionId === DEMO_CHAT_SESSION.id;
  const chatSessionsLoaded =
    store.chatSessionsSelectors.selectChatSessionsLoaded.useValue(chatBookId);
  const chatSessionsError =
    store.chatSessionsSelectors.selectChatSessionsError.useValue(chatBookId);
  const initialMessages = useMemo(
    () => toUIMessages(activeSession?.messages ?? []),
    [activeSession?.messages],
  );

  const explanationScopeRef = useRef({ active: false, bookId: chatBookId });
  useEffect(() => {
    const scope = { active: true, bookId: chatBookId };
    explanationScopeRef.current = scope;
    return () => {
      scope.active = false;
    };
  }, [chatBookId]);

  const startExplanationSession = useCallback(
    (message: string) => {
      const scope = explanationScopeRef.current;
      return new Promise<boolean>((resolve) => {
        store.dispatch(
          createChatSessionRequested(
            chatBookId,
            undefined,
            () => {
              if (!scope.active || scope.bookId !== chatBookId) {
                resolve(false);
                return;
              }
              setExplainPrompt(message);
              resolve(true);
            },
            (error) => {
              console.error("Failed to start explanation chat:", error);
              resolve(false);
            },
          ),
        );
      });
    },
    [chatBookId, store],
  );

  const consumePendingExplanation = useCallback(
    (expectedMessage?: string) => {
      const message = pendingChatPromptMap.current.get(chatBookId);
      if (!message || (expectedMessage !== undefined && message !== expectedMessage)) return;
      if (explanationInFlightRef.current?.bookId === chatBookId) return;

      const inFlight = { bookId: chatBookId, message };
      explanationInFlightRef.current = inFlight;
      startExplanationSession(message)
        .then((started) => {
          if (started && pendingChatPromptMap.current.get(chatBookId) === message) {
            pendingChatPromptMap.current.delete(chatBookId);
          }
        })
        .finally(() => {
          if (explanationInFlightRef.current === inFlight) {
            explanationInFlightRef.current = null;
          }
        });
    },
    [chatBookId, pendingChatPromptMap, startExplanationSession],
  );

  const chatReady =
    isAuthenticated &&
    !hasReservedChatIds &&
    chatSessionsLoaded &&
    bookContext !== null &&
    activeSessionId !== null;

  useEffect(() => {
    if (!isAuthenticated) return;

    const handleExplain = (event: Event) => {
      const { bookId: eventBookId, message } = (
        event as CustomEvent<{ bookId: string; message: string }>
      ).detail;
      if (!chatReady || eventBookId !== chatBookId) return;
      consumePendingExplanation(message);
    };

    window.addEventListener("chat:explain", handleExplain);
    return () => window.removeEventListener("chat:explain", handleExplain);
  }, [chatBookId, chatReady, consumePendingExplanation, isAuthenticated]);

  useEffect(() => {
    if (!chatReady) return;
    consumePendingExplanation();
  }, [chatReady, consumePendingExplanation]);

  useEffect(() => {
    if (!isAuthenticated && chatBookId !== DEMO_BOOK_ID) return;
    if (isAuthenticated && chatBookId === DEMO_BOOK_ID) return;
    let cancelled = false;
    setLoadError(null);
    store.dispatch(hydrateChatSessionsRequested(chatBookId, isAuthenticated));

    const load = async () => {
      try {
        const book = await BookService.getBook(chatBookId).catch((error: unknown) => {
          if (error instanceof Error && "_tag" in error && error._tag === "BookNotFoundError") {
            return null;
          }
          throw error;
        });
        if (cancelled) return;
        if (!book) {
          setLoadError(
            "Book not found. This chat panel may have been restored from a saved layout for a deleted book.",
          );
          return;
        }

        const bookData = await BookService.getBookData(chatBookId);
        if (cancelled) return;

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
            await ensureBookChaptersUploaded(chatBookId, { chapters, format: book.format });
          } catch (error) {
            console.error("Failed to upload chapters for chat context:", error);
          }
        }
        if (cancelled) return;

        setBookContext({ title: book.title, author: book.author, chapters });
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
  }, [chatBookId, isAuthenticated, store]);

  const initialMessagesRef = useRef(initialMessages);
  const renderedSessionIdRef = useRef(activeSessionId);

  useEffect(() => {
    if (renderedSessionIdRef.current !== activeSessionId) {
      renderedSessionIdRef.current = activeSessionId;
      initialMessagesRef.current = initialMessages;
      return;
    }
    if (!messagesDiffer(initialMessagesRef.current, initialMessages)) return;
    setChatMessagesRef.current?.(initialMessages);
    initialMessagesRef.current = initialMessages;
  }, [activeSessionId, initialMessages]);

  useEffect(() => {
    if (!isAuthenticated || !activeSessionId || hasReservedChatIds) return;
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
        }
        store.dispatch(
          cacheChatMessagesRequested(
            chatBookId,
            activeSessionId,
            uiMessagesToChatMessages(serverMessages),
          ),
        );
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, chatBookId, hasReservedChatIds, isAuthenticated, store]);

  const chatSyncVersion = useSyncListener(["chat_message", "chat_session"]);

  useEffect(() => {
    if (chatSyncVersion === 0 || !activeSessionId) return;
    store.dispatch(hydrateChatSessionsRequested(chatBookId));
  }, [activeSessionId, chatBookId, chatSyncVersion, store]);

  const handleSwitchSession = useCallback(
    (sessionId: string) => {
      store.dispatch(
        selectChatSessionRequested(chatBookId, sessionId, undefined, (error) =>
          console.error("Failed to switch chat session:", error),
        ),
      );
    },
    [chatBookId, store],
  );

  const handleNewSession = useCallback(() => {
    store.dispatch(
      createChatSessionRequested(chatBookId, undefined, undefined, (error) =>
        console.error("Failed to create chat session:", error),
      ),
    );
  }, [chatBookId, store]);

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
  const handleAuthenticated = useCallback(
    (userId: string) => {
      const typedText = textareaRef.current?.value.trim();
      if (typedText) {
        setPendingChatIntent((intent) =>
          resolvePendingChatMessage(intent) ? intent : { type: "typed", text: typedText },
        );
      }
      return new Promise<void>((resolve) => {
        store.dispatch(
          adoptDemoBookRequested(
            userId,
            (adopted) => {
              setAdoptedBookId(adopted.bookId);
              store.dispatch(hydrateChatSessionsRequested(adopted.bookId, true));
              setAdoptionError(null);
              setResumeAfterAuth(true);
              queueMicrotask(() => setOnboardingOpen(false));
              resolve();
            },
            (error) => {
              console.error("Failed to adopt demo library:", error);
              setAdoptionError(
                "Your account is ready, but we couldn't finish setting up the demo library. Check your connection and reload to try again.",
              );
              setResumeAfterAuth(false);
              queueMicrotask(() => setOnboardingOpen(false));
              resolve();
            },
          ),
        );
      });
    },
    [store],
  );
  const handleResumeComplete = useCallback(() => {
    setPendingChatIntent({ type: "none" });
    setResumeAfterAuth(false);
    setExplainPrompt(null);
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

  if (isAuthenticated && hasReservedChatIds) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Preparing your book…</p>
      </div>
    );
  }

  if (!isAuthenticated && !isLoggedOutDemoBook) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-center text-muted-foreground">
          Sign in to chat with <span className="italic">{bookTitle}</span>
        </p>
        <Button render={<a href="/login" />} nativeButton={false} variant="default">
          Sign in
        </Button>
      </div>
    );
  }

  if (loadError || (chatSessionsError && !activeSession)) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">{loadError ?? chatSessionsError?.message}</p>
      </div>
    );
  }

  if (adoptionError) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-center text-muted-foreground">{adoptionError}</p>
      </div>
    );
  }

  if (!chatSessionsLoaded || !bookContext || (isAuthenticated && !activeSessionId)) {
    return (
      <div className="flex">
        <p className="text-muted-foreground text-xs">Loading chat…</p>
      </div>
    );
  }

  if (!isAuthenticated && !isLoggedOutDemoSession) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
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
        key={activeSessionId}
        bookId={chatBookId}
        bookTitle={bookTitle}
        bookFormat={bookFormat}
        initialMessages={initialMessages}
        bookDataRef={bookDataRef}
        textareaRef={textareaRef}
        inputRef={inputRef}
        activeSessionId={activeSessionId}
        onSwitchSession={handleSwitchSession}
        onNewSession={handleNewSession}
        onRegisterSetMessages={(setMessages) => {
          setChatMessagesRef.current = setMessages;
        }}
        onChatInteraction={isLoggedOutDemoSession ? openOnboarding : undefined}
        simulateDemoStream={isLoggedOutDemoSession}
        resumeMessage={
          explainPrompt ??
          (isAuthenticated && resumeAfterAuth ? (pendingMessage ?? undefined) : undefined)
        }
        onResumeComplete={handleResumeComplete}
        isVisible={isVisible}
      />
      {(onboardingOpen || isLoggedOutDemoSession) && (
        <OnboardingDialog
          open={onboardingOpen}
          onOpenChange={handleOnboardingOpenChange}
          onAuthenticated={handleAuthenticated}
        />
      )}
    </>
  );
}
