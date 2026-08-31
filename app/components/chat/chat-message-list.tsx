import type { UIMessage } from "@ai-sdk/react";
import { Marker, MarkerContent } from "~/components/ui/marker";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "~/components/ui/message-scroller";
import { cn } from "~/lib/utils";
import { useLayoutEffect } from "react";
import { ChatEmptyState, SuggestedPrompts } from "./chat-empty-state";
import { ChatMessage } from "./chat-message";
import { joinTextParts, parseSuggestedPrompts } from "./chat-utils";

export interface BookAnnotation {
  id: string;
  action: "added" | "removed";
  title: string;
  afterMessageId: string | null;
}

export function ChatMessageList({
  messages,
  status,
  bookId,
  currentChapterIndex,
  bookFormat,
  bookDataRef,
  bookAnnotations,
  messageIdSet,
  selectedBookTitles,
  sendMessage,
  isPreparingForChat = false,
  isVisible = true,
}: {
  messages: UIMessage[];
  status: string;
  bookId: string;
  currentChapterIndex?: number;
  bookFormat?: string;
  bookDataRef: React.RefObject<ArrayBuffer | null>;
  bookAnnotations: BookAnnotation[];
  messageIdSet: Set<string>;
  selectedBookTitles: string[];
  sendMessage: (message: { text: string }) => void;
  isPreparingForChat?: boolean;
  isVisible?: boolean;
}) {
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <RestoreLatestPosition isVisible={isVisible} />
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport
          className={cn("py-3", {
            "scroll-fog-bottom": messages.length > 0,
          })}
        >
          <MessageScrollerContent className="gap-3 pr-6 pl-6 md:pl-0">
            {messages.length === 0 && (
              <ChatEmptyState
                bookId={bookId}
                bookTitles={selectedBookTitles}
                chapterIndex={currentChapterIndex}
                sendMessage={sendMessage}
              />
            )}
            {messages.map((message, index) => {
              const isCurrentlyStreaming = status === "streaming" && index === messages.length - 1;
              const isLast = index === messages.length - 1;
              const inlineAnnotations = bookAnnotations.filter(
                (annotation) =>
                  annotation.afterMessageId === message.id ||
                  (isLast && !messageIdSet.has(annotation.afterMessageId ?? "")),
              );

              return (
                <MessageScrollerItem key={message.id} messageId={message.id}>
                  <ChatMessage
                    message={message}
                    bookId={bookId}
                    bookFormat={bookFormat}
                    bookDataRef={bookDataRef}
                    isStreaming={isCurrentlyStreaming}
                  />
                  {message.role === "assistant" && !isCurrentlyStreaming && (
                    <SuggestedPrompts
                      prompts={parseSuggestedPrompts(
                        joinTextParts(
                          message.parts
                            ?.filter(
                              (part): part is { type: "text"; text: string } =>
                                part.type === "text",
                            )
                            .map((part) => part.text) ?? [],
                        ),
                      )}
                      sendMessage={sendMessage}
                    />
                  )}
                  {inlineAnnotations.map((annotation) => (
                    <BookAnnotationMarker
                      key={annotation.id}
                      action={annotation.action}
                      title={annotation.title}
                    />
                  ))}
                </MessageScrollerItem>
              );
            })}
            {isPreparingForChat ? (
              <Marker role="status" aria-live="polite" className="shrink-0 py-1 text-xs">
                <MarkerContent className="shimmer">Preparing this book for chat…</MarkerContent>
              </Marker>
            ) : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

function RestoreLatestPosition({ isVisible }: { isVisible: boolean }) {
  const { scrollToEnd } = useMessageScroller();

  useLayoutEffect(() => {
    if (isVisible) scrollToEnd({ behavior: "auto" });
  }, [isVisible, scrollToEnd]);

  return null;
}

function BookAnnotationMarker({ action, title }: { action: "added" | "removed"; title: string }) {
  return (
    <Marker variant="separator" className="py-1 text-xs">
      <MarkerContent>
        <span aria-hidden>{action === "added" ? "+" : "−"}</span>{" "}
        {action === "added" ? "Added" : "Removed"} <span className="italic">{title}</span>
      </MarkerContent>
    </Marker>
  );
}
