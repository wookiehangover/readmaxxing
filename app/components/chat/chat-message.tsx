import { createElement, memo, type ComponentProps, useCallback, useMemo } from "react";
import type { UIMessage } from "@ai-sdk/react";
import { Streamdown } from "streamdown";
import type { Components } from "streamdown";
import { Bubble, BubbleContent } from "~/components/ui/bubble";
import { Message, MessageContent } from "~/components/ui/message";
import type { SEBook } from "~/lib/standard-ebooks";
import { useBookRefNavigation } from "~/hooks/use-book-ref-navigation";
import { useAppStore } from "~/lib/themis/provider";
import { cn } from "~/lib/utils";
import { getToolInfo, joinTextParts, stripSuggestedPrompts } from "./chat-utils";
import { SEBookCardsInChat } from "./se-book-cards";
import type { OpenStep } from "./tool-steps/step-marker";
import { StepTrail } from "./tool-steps/step-trail";
import { segmentParts } from "./tool-steps/tool-step-model";

type StreamdownHeadingProps = ComponentProps<"h1"> & { node?: unknown };

function streamdownHeading(level: 1 | 2 | 3 | 4 | 5 | 6, className: string) {
  const tag = `h${level}` as const;

  return ({ node: _node, className: incomingClassName, ...props }: StreamdownHeadingProps) =>
    createElement(tag, {
      ...props,
      className: cn(incomingClassName, className),
      "data-streamdown": `heading-${level}`,
    });
}

const quietStreamdownHeadings = {
  h1: streamdownHeading(1, "text-[1.125em] font-medium"),
  h2: streamdownHeading(2, "text-[1em] font-medium"),
  h3: streamdownHeading(3, "text-[0.9375em]"),
  h4: streamdownHeading(4, "text-[0.875em]"),
  h5: streamdownHeading(5, "text-[0.875em]"),
  h6: streamdownHeading(6, "text-[0.8125em]"),
} satisfies Components;

function ChatMessageImpl({
  message,
  bookId,
  bookFormat,
  bookDataRef,
  isStreaming,
}: {
  message: UIMessage;
  bookId: string;
  bookFormat?: string;
  bookDataRef: React.RefObject<ArrayBuffer | null>;
  isStreaming?: boolean;
}) {
  const isUser = message.role === "user";
  const { navigateToQuote, navigateToChapter } = useBookRefNavigation({
    bookId,
    bookFormat,
    bookDataRef,
  });
  const store = useAppStore();
  const books = store.booksSelectors.selectAllBooks.useValue();

  // Resolve a book id to its title via the workspace books list. Falls back to
  // the chat's own/primary book when the id is absent (back-compat with the
  // old search_book output shape) or unknown.
  const resolveBookTitle = useCallback(
    (id: string | undefined): string | undefined => {
      const targetId = id ?? bookId;
      return books.find((book) => book.id === targetId)?.title;
    },
    [bookId, books],
  );

  // Whether more than one book is currently in the workspace. When only one
  // book is in play the per-search book label can stay subtle/omitted.
  const hasMultipleBooks = books.length > 1;

  const parts = message.parts ?? [];
  const toolParts = parts.filter((p: any) => getToolInfo(p) !== null);
  const segments = useMemo(
    () =>
      isUser ? [] : segmentParts(parts, { resolveBookTitle, showBookLabel: hasMultipleBooks }),
    [isUser, parts, resolveBookTitle, hasMultipleBooks],
  );
  const userText = isUser
    ? joinTextParts(
        parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text),
      )
    : "";

  const openStep = useCallback<OpenStep>(
    (step, hit) => {
      if (hit) {
        const excerpt = (hit.excerpt ?? "").replace(/^[\s.…]+|[\s.…]+$/g, "");
        void navigateToQuote(excerpt, hit.chapterIndex);
      } else if (step.quote && step.kind === "highlight") {
        void navigateToQuote(step.quote, step.chapterIndex);
      } else {
        void navigateToChapter(step.chapterIndex);
      }
    },
    [navigateToQuote, navigateToChapter],
  );

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
      ...quietStreamdownHeadings,
      ref: ({ children, chapter, query }: Record<string, unknown>) => {
        const queryStr = typeof query === "string" ? query : "";
        if (!queryStr) {
          return <span>{children as React.ReactNode}</span>;
        }

        const chapterIndex = typeof chapter === "string" ? parseInt(chapter, 10) : NaN;
        const handleClick = () => {
          void navigateToQuote(queryStr, Number.isNaN(chapterIndex) ? undefined : chapterIndex);
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
    [navigateToQuote],
  );

  return (
    <Message align={isUser ? "end" : "start"}>
      <MessageContent>
        <Bubble
          align="start"
          variant={isUser ? "secondary" : "ghost"}
          className={cn("max-w-prose", {
            "my-5": isUser,
            "text-foreground": !isUser,
          })}
        >
          <BubbleContent>
            {isUser ? (
              userText && <p className="whitespace-pre-wrap">{userText}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {segments.map((segment, index) => {
                  const isLast = index === segments.length - 1;
                  if (segment.type === "steps") {
                    const hasCatalog = segment.entries.some(
                      (e) => e.type === "step" && e.step.kind === "catalog",
                    );
                    return (
                      <div key={segment.key} className="flex flex-col gap-3">
                        <StepTrail
                          entries={segment.entries}
                          live={!!isStreaming && isLast}
                          bookId={bookId}
                          onOpen={openStep}
                        />
                        {hasCatalog && seBooks.length > 0 && <SEBookCardsInChat books={seBooks} />}
                      </div>
                    );
                  }
                  const text = stripSuggestedPrompts(segment.text);
                  if (!text) return null;
                  return (
                    <div
                      key={segment.key}
                      className="typeset [--typeset-flow:0.75em] [--typeset-leading:1.6] [--typeset-size:0.875rem]"
                    >
                      <Streamdown
                        caret="block"
                        isAnimating={!!isStreaming && isLast}
                        allowedTags={{ ref: ["chapter", "query"] }}
                        components={streamdownComponents}
                      >
                        {text}
                      </Streamdown>
                    </div>
                  );
                })}
              </div>
            )}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

/**
 * Memoized: the chat panel re-renders on every streamed token, and without
 * memoization every historical message re-runs its text joins and re-renders
 * its Streamdown markdown tree per token. `useChat` keeps stable references
 * for messages that haven't changed (only the streaming message is replaced
 * each update), so a shallow prop compare skips all settled messages.
 */
export const ChatMessage = memo(ChatMessageImpl);
