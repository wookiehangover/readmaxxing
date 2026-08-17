import type { UIMessage } from "@ai-sdk/react";
import { Marker, MarkerContent } from "~/components/ui/marker";
import { ScrollArea } from "~/components/ui/scroll-area";
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
    <ScrollArea
      className={cn("min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]]:py-3", {
        "[&_[data-slot=scroll-area-viewport]]:scroll-fog-bottom": messages.length > 0,
      })}
    >
      <div className="flex h-max min-h-full flex-col gap-3 pr-6">
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
            <div key={message.id} className="min-w-0 shrink-0">
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
                          (part): part is { type: "text"; text: string } => part.type === "text",
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
            </div>
          );
        })}
      </div>
    </ScrollArea>
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
