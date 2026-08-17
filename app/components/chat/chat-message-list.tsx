import type { UIMessage } from "@ai-sdk/react";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "~/components/ui/message-scroller";
import { Marker, MarkerContent } from "~/components/ui/marker";
import { cn } from "~/lib/utils";
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
}) {
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className="flex-1">
        <MessageScrollerViewport
          className={cn("relative py-3", {
            "scroll-fog-bottom": messages.length > 0,
          })}
        >
          <MessageScrollerContent className="gap-3 pr-6">
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
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.role === "user"}
                >
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
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
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
