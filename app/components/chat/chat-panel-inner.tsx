import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat, type UIMessage } from "@ai-sdk/react";
import type { JSONContent } from "@tiptap/react";
import {
  useOptionalWorkspace,
  type NotebookEditorCallbacks,
} from "~/lib/context/workspace-context";
import { useReadingChatMenuRegistration } from "~/lib/context/reading-chat-menu-context";
import { generateChatSessionTitleRequested } from "~/lib/themis/chat-sessions/chat-sessions-slice";
import { useAppStore } from "~/lib/themis/provider";
import { ChatInput } from "./chat-input";
import type { ChatIntent } from "./chat-intent";
import { ChatMessageList, type BookAnnotation } from "./chat-message-list";
import { createChatTransport, createDemoIntroChat } from "./chat-utils";
import { useChatToolHandlers } from "./use-chat-tool-handlers";
import { useOpenBooks } from "./use-open-books";
import { useResumeMessage } from "./use-resume-message";
import { useStreamingAppend } from "./use-streaming-append";

export function ChatPanelInner({
  bookId,
  bookTitle,
  bookFormat,
  initialMessages,
  bookDataRef,
  textareaRef,
  inputRef,
  activeSessionId,
  onSwitchSession,
  onNewSession,
  onRegisterSetMessages,
  onChatInteraction,
  simulateDemoStream,
  resumeMessage,
  onResumeComplete,
}: {
  bookId: string;
  bookTitle: string;
  bookFormat?: string;
  initialMessages: UIMessage[];
  bookDataRef: React.RefObject<ArrayBuffer | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  inputRef: React.MutableRefObject<string>;
  activeSessionId: string;
  onSwitchSession: (sessionId: string) => void;
  onNewSession: () => void;
  onRegisterSetMessages?: (fn: (messages: UIMessage[]) => void) => void;
  onChatInteraction?: (intent: ChatIntent) => void;
  simulateDemoStream?: boolean;
  resumeMessage?: string;
  onResumeComplete?: () => void;
}) {
  const store = useAppStore();
  const activeSession = store.chatSessionsSelectors.selectActiveSessionByBook.useValue(bookId);
  const workspace = useOptionalWorkspace();
  const fallbackChatContextMap = useRef(
    new Map<
      string,
      { currentChapterIndex: number; currentSpineHref: string; visibleText: string }
    >(),
  );
  const fallbackNotebookEditorCallbackMap = useRef(new Map<string, NotebookEditorCallbacks>());
  const chatContextMap = workspace?.chatContextMap ?? fallbackChatContextMap;
  const notebookEditorCallbackMap =
    workspace?.notebookEditorCallbackMap ?? fallbackNotebookEditorCallbackMap;
  const pendingHighlightPillMap = workspace?.pendingHighlightPillMap;
  const registerReadingChatMenu = useReadingChatMenuRegistration();
  const [highlightPill, setHighlightPill] = useState<{
    text: string;
    pageLabel: string;
  } | null>(null);

  const consumePendingHighlightPill = useCallback(() => {
    if (!pendingHighlightPillMap) return;
    const pendingPill = pendingHighlightPillMap.current.get(bookId);
    if (!pendingPill) return;
    setHighlightPill(pendingPill);
    pendingHighlightPillMap.current.delete(bookId);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [bookId, pendingHighlightPillMap, textareaRef]);

  useEffect(() => {
    consumePendingHighlightPill();
  }, [consumePendingHighlightPill]);

  const [currentChapterIndex, setCurrentChapterIndex] = useState<number>();
  const currentChapterRef = useRef<number | undefined>(undefined);
  const visibleTextRef = useRef("");
  useEffect(() => {
    const updateContext = () => {
      const latest = chatContextMap.current.get(bookId);
      const nextChapterIndex = latest?.currentChapterIndex;
      currentChapterRef.current = nextChapterIndex;
      visibleTextRef.current = latest?.visibleText ?? "";
      setCurrentChapterIndex((current) =>
        current === nextChapterIndex ? current : nextChapterIndex,
      );
    };
    updateContext();
    const interval = setInterval(updateContext, 1000);
    return () => clearInterval(interval);
  }, [bookId, chatContextMap]);

  const openBooks = useOpenBooks(workspace);
  const openBooksRef = useRef(openBooks);
  openBooksRef.current = openBooks;
  const openBooksKey = useMemo(
    () => openBooks.map((book) => `${book.id}:${book.title}`).join("\u0000"),
    [openBooks],
  );
  const [selectedBookIds, setSelectedBookIds] = useState<string[]>([bookId]);
  const selectedBookIdsRef = useRef(selectedBookIds);
  selectedBookIdsRef.current = selectedBookIds;

  const toggleSelectedBook = useCallback(
    (id: string) => {
      if (id === bookId) return;
      setSelectedBookIds((previous) =>
        previous.includes(id) ? previous.filter((book) => book !== id) : [...previous, id],
      );
    },
    [bookId],
  );

  const [bookAnnotations, setBookAnnotations] = useState<BookAnnotation[]>([]);
  const bookSelection = useMemo(
    () => ({
      openBooks,
      selectedBookIds,
      ownBookId: bookId,
      onToggleBook: toggleSelectedBook,
    }),
    [openBooks, selectedBookIds, bookId, toggleSelectedBook],
  );
  useEffect(() => {
    if (!registerReadingChatMenu) return;
    return registerReadingChatMenu({
      bookId,
      activeSessionId,
      bookSelection,
      onSwitchSession,
      onNewSession,
    });
  }, [
    activeSessionId,
    bookId,
    bookSelection,
    onNewSession,
    onSwitchSession,
    registerReadingChatMenu,
  ]);
  const selectedBookTitles = useMemo(() => {
    const titleById = new Map(openBooksRef.current.map((book) => [book.id, book.title]));
    titleById.set(bookId, bookTitle);
    return selectedBookIds.map((id) => titleById.get(id) ?? bookTitle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBookIds, openBooksKey, bookId, bookTitle]);

  useEffect(() => {
    const openIds = new Set(openBooksRef.current.map((book) => book.id));
    setSelectedBookIds((previous) => {
      const next = previous.filter((id) => id === bookId || openIds.has(id));
      return next.length === previous.length ? previous : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openBooksKey, bookId]);

  const getBookContext = useCallback(
    (id: string) => {
      if (id === bookId) {
        return {
          visibleText: visibleTextRef.current,
          currentChapterIndex: currentChapterRef.current,
        };
      }
      const context = chatContextMap.current.get(id);
      return {
        visibleText: context?.visibleText,
        currentChapterIndex: context?.currentChapterIndex,
      };
    },
    [bookId, chatContextMap],
  );
  const demoChat = useMemo(
    () => (simulateDemoStream ? createDemoIntroChat() : null),
    [simulateDemoStream],
  );
  const transport = useMemo(() => {
    if (demoChat) return demoChat.transport({ delayMs: 25 });
    return createChatTransport({
      sessionId: activeSessionId,
      bookId,
      visibleTextRef,
      currentChapterRef,
      selectedBookIdsRef,
      getBookContext,
    });
  }, [activeSessionId, bookId, demoChat, getBookContext]);

  const messagesRef = useRef<UIMessage[]>(initialMessages);
  const streamedToolCallIdRef = useRef<Map<string, JSONContent>>(new Map());
  const { onToolCall, onFinish: onToolFinish } = useChatToolHandlers({
    bookId,
    bookFormat,
    bookDataRef,
    streamedToolCallIdRef,
  });
  const titleGeneratedRef = useRef(false);
  const onFinish = useCallback(
    (event: { message: UIMessage }) => {
      if (simulateDemoStream) return;
      onToolFinish(event);
      const currentMessages = messagesRef.current;
      if (
        titleGeneratedRef.current ||
        event.message.role !== "assistant" ||
        currentMessages.length > 5
      ) {
        return;
      }
      titleGeneratedRef.current = true;

      if (!activeSession || activeSession.title) return;
      store.dispatch(generateChatSessionTitleRequested(bookId, activeSessionId, currentMessages));
    },
    [activeSession, activeSessionId, bookId, onToolFinish, simulateDemoStream, store],
  );

  const chatInitialMessages = useMemo(
    () => demoChat?.get(1) ?? initialMessages,
    [demoChat, initialMessages],
  );

  const { messages, regenerate, sendMessage, setMessages, status, stop } = useChat({
    id: activeSessionId,
    transport,
    messages: chatInitialMessages,
    resume: !onChatInteraction,
    onToolCall: simulateDemoStream ? undefined : (onToolCall as any),
    onFinish,
    onError: (error) => console.error("Chat error:", error),
  });
  messagesRef.current = messages;

  const didSimulateDemoStreamRef = useRef(false);
  useEffect(() => {
    if (!demoChat || didSimulateDemoStreamRef.current || status !== "ready") return;
    didSimulateDemoStreamRef.current = true;
    void regenerate().catch((error: unknown) => {
      console.error("Failed to simulate demo chat:", error);
    });
  }, [demoChat, regenerate, status]);

  const previousSelectedBookIdsRef = useRef(selectedBookIds);
  useEffect(() => {
    const previous = previousSelectedBookIdsRef.current;
    previousSelectedBookIdsRef.current = selectedBookIds;
    if (messagesRef.current.length === 0) return;

    const previousSet = new Set(previous);
    const nextSet = new Set(selectedBookIds);
    const added = selectedBookIds.filter((id) => !previousSet.has(id));
    const removed = previous.filter((id) => !nextSet.has(id));
    if (added.length === 0 && removed.length === 0) return;

    const titleById = new Map(openBooksRef.current.map((book) => [book.id, book.title]));
    titleById.set(bookId, bookTitle);
    const afterMessageId = messagesRef.current.at(-1)?.id ?? null;
    const newMarkers: BookAnnotation[] = [
      ...added.map((id) => ({
        id: `annot-${crypto.randomUUID()}`,
        action: "added" as const,
        title: titleById.get(id) ?? id,
        afterMessageId,
      })),
      ...removed.map((id) => ({
        id: `annot-${crypto.randomUUID()}`,
        action: "removed" as const,
        title: titleById.get(id) ?? id,
        afterMessageId,
      })),
    ];
    setBookAnnotations((markers) => [...markers, ...newMarkers]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBookIds, openBooksKey, bookId, bookTitle]);

  useEffect(() => {
    onRegisterSetMessages?.(setMessages);
  }, [setMessages, onRegisterSetMessages]);

  useStreamingAppend({
    messages,
    bookId,
    status,
    notebookEditorCallbackMap,
    streamedToolCallIdRef,
  });

  const isLoading = status === "streaming" || status === "submitted";
  useResumeMessage({
    resumeMessage,
    isLoading,
    gated: Boolean(onChatInteraction),
    sendMessage,
    onResumeComplete,
    inputRef,
    textareaRef,
  });
  const messageIdSet = useMemo(() => new Set(messages.map((message) => message.id)), [messages]);
  const handleSendMessage = useCallback(
    (message: { text: string }) => {
      if (onChatInteraction) {
        onChatInteraction({ type: "suggested", text: message.text });
        return;
      }
      void sendMessage(message);
    },
    [onChatInteraction, sendMessage],
  );
  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (onChatInteraction) {
        onChatInteraction({ type: "typed", text: inputRef.current });
        return;
      }
      const text = inputRef.current.trim();
      if (!text || isLoading) return;
      sendMessage({ text });
      inputRef.current = "";
      if (textareaRef.current) textareaRef.current.value = "";
    },
    [sendMessage, isLoading, inputRef, textareaRef, onChatInteraction],
  );
  return (
    <div className="flex h-full flex-col" onFocusCapture={consumePendingHighlightPill}>
      <ChatMessageList
        messages={messages}
        status={status}
        bookId={bookId}
        currentChapterIndex={currentChapterIndex}
        bookFormat={bookFormat}
        bookDataRef={bookDataRef}
        bookAnnotations={bookAnnotations}
        messageIdSet={messageIdSet}
        selectedBookTitles={selectedBookTitles}
        sendMessage={handleSendMessage}
      />
      <ChatInput
        textareaRef={textareaRef}
        inputRef={inputRef}
        isLoading={isLoading}
        onSubmit={handleSubmit}
        onStop={stop}
        highlightPill={highlightPill ?? undefined}
        onClearHighlightPill={() => setHighlightPill(null)}
        onInteraction={onChatInteraction}
      />
    </div>
  );
}
