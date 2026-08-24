import { createElement, memo, type ComponentProps, useCallback, useMemo } from "react";
import type { UIMessage } from "@ai-sdk/react";
import { Streamdown } from "streamdown";
import type { Components } from "streamdown";
import { Bubble, BubbleContent } from "~/components/ui/bubble";
import { Message, MessageContent } from "~/components/ui/message";
import type { SEBook } from "~/lib/standard-ebooks";
import { useWorkspace } from "~/lib/context/workspace-context";
import { useAppStore } from "~/lib/themis/provider";
import { cn } from "~/lib/utils";
import { getToolInfo, joinTextParts, stripSuggestedPrompts } from "./chat-utils";
import { SEBookCardsInChat } from "./se-book-cards";
import { ToolStepsDetails } from "./chat-tool-steps";

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
  const { navigateInCluster, findTocForBook, applyTempHighlightForBook } = useWorkspace();
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

  const textParts =
    message.parts?.filter((p): p is { type: "text"; text: string } => p.type === "text") ?? [];
  const toolParts = message.parts?.filter((p: any) => getToolInfo(p) !== null) ?? [];
  const reasoningParts = message.parts?.filter((p) => p.type === "reasoning") ?? [];

  const rawText = joinTextParts(textParts.map((p) => p.text));
  const text = isUser ? rawText : stripSuggestedPrompts(rawText);
  const hasProcessSteps = toolParts.length > 0 || reasoningParts.length > 0;

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

        const chapterStr = typeof chapter === "string" ? chapter : "";

        const handleClick = async () => {
          console.debug("[ChatPanel] handleClick", { bookId });
          const data = bookDataRef.current;
          if (!data) {
            console.warn("Ref navigation: no book data available");
            return;
          }

          try {
            if (bookFormat === "pdf") {
              // PDF path: search for text and navigate to page
              const pdfjs = await import("pdfjs-dist");
              const { searchPdf } = await import("~/lib/pdf/pdf-search");
              const workerUrl = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url);
              pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.href;
              const dataCopy = new Uint8Array(data).slice();
              const loadingTask = pdfjs.getDocument({ data: dataCopy });
              const doc = await loadingTask.promise;
              try {
                const results = await searchPdf(doc, queryStr);
                if (results.length > 0) {
                  await navigateInCluster(bookId, `page:${results[0].page}`);
                  return;
                }
              } finally {
                await loadingTask.destroy().catch(() => {});
              }

              // Fallback: navigate to chapter/page index
              if (chapterStr) {
                const pageNum = parseInt(chapterStr, 10);
                if (!isNaN(pageNum)) {
                  await navigateInCluster(bookId, `page:${pageNum + 1}`);
                  return;
                }
              }

              console.debug("Ref navigation (PDF): no results for query:", queryStr);
            } else {
              const { fuzzySearchEpubForCfi } = await import("~/lib/epub/epub-search");
              const results = await fuzzySearchEpubForCfi(data.slice(0), queryStr);

              if (results.length > 0) {
                const cfi = results[0].cfi;
                await navigateInCluster(bookId, cfi);
                applyTempHighlightForBook(bookId, cfi);
                return;
              }

              // Fallback: navigate to chapter start via TOC
              if (chapterStr) {
                const chapterIndex = parseInt(chapterStr, 10);
                if (!isNaN(chapterIndex)) {
                  const toc = findTocForBook(bookId);
                  if (toc && toc[chapterIndex]) {
                    console.debug("Ref navigation: falling back to chapter", chapterIndex);
                    await navigateInCluster(bookId, toc[chapterIndex].href);
                    return;
                  }
                }
              }

              console.debug("Ref navigation: no results for query:", queryStr);
            }
          } catch (err) {
            console.warn("Ref navigation failed:", err);
          }
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
    [bookId, bookFormat, bookDataRef, navigateInCluster, findTocForBook, applyTempHighlightForBook],
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
            {hasProcessSteps && (
              <ToolStepsDetails
                toolParts={toolParts}
                reasoningParts={reasoningParts}
                isStreaming={isStreaming}
                resolveBookTitle={resolveBookTitle}
                showBookLabel={hasMultipleBooks}
              />
            )}
            {seBooks.length > 0 && <SEBookCardsInChat books={seBooks} />}
            {text &&
              (isUser ? (
                <p className="whitespace-pre-wrap">{text}</p>
              ) : (
                <div className="typeset [--typeset-flow:0.75em] [--typeset-leading:1.6] [--typeset-size:0.875rem]">
                  <Streamdown
                    caret="block"
                    isAnimating={isStreaming}
                    allowedTags={{ ref: ["chapter", "query"] }}
                    components={streamdownComponents}
                  >
                    {text}
                  </Streamdown>
                </div>
              ))}
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
