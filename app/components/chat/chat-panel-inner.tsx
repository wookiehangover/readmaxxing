import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { Effect } from "effect";
import { Plus } from "lucide-react";
import { Button } from "~/components/ui/button";
import { AppRuntime } from "~/lib/effect-runtime";
import {
  useOptionalWorkspace,
  type NotebookEditorCallbacks,
} from "~/lib/context/workspace-context";
import { ChatService } from "~/lib/stores/chat-store";
import { ChatBookSelector, type BookSelection } from "./chat-book-selector";
import { ChatInput } from "./chat-input";
import type { ChatIntent } from "./chat-intent";
import { ChatMessageList, type BookAnnotation } from "./chat-message-list";
import { ChatSessionList, EditableTitle, SessionMenuButton } from "./chat-session-menu";
import { createChatTransport } from "./chat-utils";
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
  sessionTitle,
  onSwitchSession,
  onNewSession,
  onSessionTitleChange,
  onRegisterSetMessages,
  onChatInteraction,
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
  sessionTitle: string;
  onSwitchSession: (sessionId: string) => void;
  onNewSession: () => void;
  onSessionTitleChange: (title: string) => void;
  onRegisterSetMessages?: (fn: (messages: UIMessage[]) => void) => void;
  onChatInteraction?: (intent: ChatIntent) => void;
  resumeMessage?: string;
  onResumeComplete?: () => void;
}) {
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
  const [showSessionList, setShowSessionList] = useState(false);
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

  const currentChapterRef = useRef<number | undefined>(undefined);
  const visibleTextRef = useRef("");
  useEffect(() => {
    const context = chatContextMap.current.get(bookId);
    if (context) {
      currentChapterRef.current = context.currentChapterIndex;
      visibleTextRef.current = context.visibleText ?? "";
    }

    const interval = setInterval(() => {
      const latest = chatContextMap.current.get(bookId);
      if (latest) {
        currentChapterRef.current = latest.currentChapterIndex;
        visibleTextRef.current = latest.visibleText ?? "";
      }
    }, 1000);
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
  const bookSelection: BookSelection = useMemo(
    () => ({
      openBooks,
      selectedBookIds,
      ownBookId: bookId,
      onToggleBook: toggleSelectedBook,
    }),
    [openBooks, selectedBookIds, bookId, toggleSelectedBook],
  );
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
  const transport = useMemo(
    () =>
      createChatTransport({
        sessionId: activeSessionId,
        bookId,
        visibleTextRef,
        currentChapterRef,
        selectedBookIdsRef,
        getBookContext,
      }),
    [activeSessionId, bookId, getBookContext],
  );

  const messagesRef = useRef<UIMessage[]>(initialMessages);
  const streamedToolCallIdRef = useRef<Set<string>>(new Set());
  const { onToolCall, onFinish: onToolFinish } = useChatToolHandlers({
    bookId,
    bookFormat,
    bookDataRef,
    streamedToolCallIdRef,
  });
  const titleGeneratedRef = useRef(false);
  const onFinish = useCallback(
    (event: { message: UIMessage }) => {
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

      const generateTitle = async () => {
        const session = await AppRuntime.runPromise(
          Effect.gen(function* () {
            const service = yield* ChatService;
            const activeId = yield* service.getActiveSessionId(bookId);
            if (!activeId) return null;
            return yield* service.getSession(activeId, bookId);
          }),
        );
        if (!session || session.title) return;

        const response = await fetch("/api/chat-title", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: currentMessages }),
        });
        if (!response.ok) return;
        const { title } = (await response.json()) as { title: string };
        if (!title) return;

        await AppRuntime.runPromise(
          ChatService.pipe(
            Effect.andThen((service) =>
              service.updateSessionTitle(session.id, session.bookId, title),
            ),
          ),
        );
        onSessionTitleChange(title);
      };
      generateTitle().catch(console.error);
    },
    [onToolFinish, bookId, onSessionTitleChange],
  );

  const { messages, sendMessage, setMessages, status, stop } = useChat({
    id: activeSessionId,
    transport,
    messages: initialMessages,
    resume: !onChatInteraction,
    onToolCall: onToolCall as any,
    onFinish,
    onError: (error) => console.error("Chat error:", error),
  });
  messagesRef.current = messages;

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
  const handleSwitchSessionFromList = useCallback(
    (sessionId: string) => {
      setShowSessionList(false);
      if (sessionId !== activeSessionId) onSwitchSession(sessionId);
    },
    [activeSessionId, onSwitchSession],
  );
  const handleNewSessionFromList = useCallback(() => {
    setShowSessionList(false);
    onNewSession();
  }, [onNewSession]);

  return (
    <div className="flex h-full flex-col" onFocusCapture={consumePendingHighlightPill}>
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <SessionMenuButton
          showSessionList={showSessionList}
          onToggle={() => setShowSessionList((value) => !value)}
        />
        {showSessionList ? (
          <h3 className="min-w-0 flex-1 truncate text-sm font-medium">Sessions</h3>
        ) : sessionTitle ? (
          <EditableTitle
            value={sessionTitle}
            className="min-w-0 flex-1 text-sm font-medium"
            onSave={(newTitle) => {
              AppRuntime.runPromise(
                ChatService.pipe(
                  Effect.andThen((service) =>
                    service.updateSessionTitle(activeSessionId, bookId, newTitle),
                  ),
                ),
              )
                .then(() => onSessionTitleChange(newTitle))
                .catch(console.error);
            }}
          />
        ) : null}
        {!showSessionList && (
          <div className="ml-auto flex items-center gap-1">
            <ChatBookSelector {...bookSelection} />
            <Button
              variant="ghost"
              size="icon"
              onClick={onNewSession}
              title="New chat"
              className="size-7"
            >
              <Plus />
              <span className="sr-only">New chat</span>
            </Button>
          </div>
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
          <ChatMessageList
            messages={messages}
            status={status}
            bookId={bookId}
            bookFormat={bookFormat}
            bookDataRef={bookDataRef}
            bookAnnotations={bookAnnotations}
            messageIdSet={messageIdSet}
            selectedBookTitles={selectedBookTitles}
            sendMessage={handleSendMessage}
          />
          <ChatInput
            bookTitle={bookTitle}
            textareaRef={textareaRef}
            inputRef={inputRef}
            isLoading={isLoading}
            onSubmit={handleSubmit}
            onStop={stop}
            highlightPill={highlightPill ?? undefined}
            onClearHighlightPill={() => setHighlightPill(null)}
            onInteraction={onChatInteraction}
          />
        </>
      )}
    </div>
  );
}
