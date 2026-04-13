import { useMemo } from "react";
import type { UIMessage } from "@ai-sdk/react";
import { ChevronRight } from "lucide-react";
import { Streamdown } from "streamdown";
import type { Components } from "streamdown";
import type { SEBook } from "~/lib/standard-ebooks";
import { cn } from "~/lib/utils";
import { useWorkspace } from "~/lib/context/workspace-context";
import { getToolInfo, stripSuggestedPrompts } from "./chat-utils";
import { SEBookCardsInChat } from "./se-book-cards";

export function ChatMessage({
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
  const { waitForNavForBook, findTocForBook, applyTempHighlightForBook } = useWorkspace();

  const textParts =
    message.parts?.filter((p): p is { type: "text"; text: string } => p.type === "text") ?? [];
  const toolParts = message.parts?.filter((p: any) => getToolInfo(p) !== null) ?? [];
  const reasoningParts = message.parts?.filter((p) => p.type === "reasoning") ?? [];

  const rawText = textParts.map((p) => p.text).join("");
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

          const navigate = await waitForNavForBook(bookId);
          if (!navigate) {
            console.warn("Ref navigation: no navigate callback for book", bookId);
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
              const doc = await pdfjs.getDocument({ data: dataCopy }).promise;
              try {
                const results = await searchPdf(doc, queryStr);
                if (results.length > 0) {
                  navigate(`page:${results[0].page}`);
                  return;
                }
              } finally {
                await doc.destroy();
              }

              // Fallback: navigate to chapter/page index
              if (chapterStr) {
                const pageNum = parseInt(chapterStr, 10);
                if (!isNaN(pageNum)) {
                  navigate(`page:${pageNum + 1}`);
                  return;
                }
              }

              console.debug("Ref navigation (PDF): no results for query:", queryStr);
            } else {
              const ePub = (await import("epubjs")).default;
              const { fuzzySearchBookForCfi } = await import("~/lib/epub/epub-search");
              const book = ePub(data.slice(0));
              try {
                const results = await fuzzySearchBookForCfi(book, queryStr);

                if (results.length > 0) {
                  const cfi = results[0].cfi;
                  navigate(cfi);
                  applyTempHighlightForBook(bookId, cfi);
                  return;
                }
              } finally {
                book.destroy();
              }

              // Fallback: navigate to chapter start via TOC
              if (chapterStr) {
                const chapterIndex = parseInt(chapterStr, 10);
                if (!isNaN(chapterIndex)) {
                  const toc = findTocForBook(bookId);
                  if (toc && toc[chapterIndex]) {
                    console.debug("Ref navigation: falling back to chapter", chapterIndex);
                    navigate(toc[chapterIndex].href);
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
    [bookId, bookFormat, bookDataRef, waitForNavForBook, findTocForBook, applyTempHighlightForBook],
  );

  return (
    <div
      className={cn("flex px-5", {
        "justify-end": isUser,
        "justify-start": !isUser,
      })}
    >
      <div
        className={cn("max-w-prose text-sm", {
          "rounded-lg px-3 py-2 bg-secondary text-secondary-foreground my-5": isUser,
          "text-foreground": !isUser,
        })}
      >
        {hasProcessSteps && (
          <ToolStepsDetails
            toolParts={toolParts}
            reasoningParts={reasoningParts}
            isStreaming={isStreaming}
          />
        )}
        {seBooks.length > 0 && <SEBookCardsInChat books={seBooks} />}
        {text &&
          (isUser ? (
            <p className="whitespace-pre-wrap">{text}</p>
          ) : (
            <Streamdown
              caret="block"
              isAnimating={isStreaming}
              allowedTags={{ ref: ["chapter", "query"] }}
              components={streamdownComponents}
            >
              {text}
            </Streamdown>
          ))}
      </div>
    </div>
  );
}

function ToolStepsDetails({
  toolParts,
  reasoningParts,
  isStreaming,
}: {
  toolParts: any[];
  reasoningParts: any[];
  isStreaming?: boolean;
}) {
  return (
    <details className="group mb-5 -ml-4" open={isStreaming || undefined}>
      <summary className="cursor-pointer text-[11px] text-muted-foreground font-mono flex items-center gap-1 list-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
        {toolParts
          .map((part) => {
            const info = getToolInfo(part);
            if (!info) return null;
            if (info.toolName === "search_book") return "Searched book";
            if (info.toolName === "read_chapter") return "Read chapter";
            if (info.toolName === "read_notes") return "Read notebook";
            if (info.toolName === "append_to_notes") return "Added to notebook";
            if (info.toolName === "create_highlight") return "Highlighted";
            if (info.toolName === "search_standard_ebooks") return "Searched Standard Ebooks";
            return info.toolName;
          })
          .filter(Boolean)
          .join(", ")}
        {toolParts.length > 0 && ` → ${toolParts.length} step${toolParts.length > 1 ? "s" : ""}`}
        {reasoningParts.length > 0 && toolParts.length === 0 && "Reasoning"}
      </summary>
      <div
        className={cn("mt-1 space-y-0.5 pl-4 text-[11px] font-mono text-muted-foreground", {
          "max-h-[4.5rem] overflow-y-auto": isStreaming,
        })}
      >
        {toolParts.map((part, i) => {
          const info = getToolInfo(part);
          if (!info) return null;
          const isComplete = info.state === "output-available";
          let label = info.toolName;
          if (info.toolName === "search_book") {
            const query = typeof info.input?.query === "string" ? info.input.query : "";
            if (isComplete && Array.isArray(info.output)) {
              label = `Searched for "${query}" → ${info.output.length} result${info.output.length !== 1 ? "s" : ""}`;
            } else {
              label = `Searching for "${query}"...`;
            }
          } else if (info.toolName === "read_chapter") {
            const title = info.input?.chapterTitle
              ? String(info.input.chapterTitle)
              : `chapter ${info.input?.chapterIndex}`;
            if (isComplete && (info.output as any)?.text) {
              label = `Read ${title} → ${(info.output as any).text.length.toLocaleString()} chars`;
            } else {
              label = `Reading ${title}...`;
            }
          } else if (info.toolName === "read_notes") {
            label = isComplete ? "Read notebook" : "Reading notebook...";
          } else if (info.toolName === "append_to_notes") {
            label = isComplete ? "Added to notebook" : "Adding to notebook...";
          } else if (info.toolName === "create_highlight") {
            const snippet =
              typeof info.input?.text === "string"
                ? (info.input.text as string).slice(0, 30) +
                  ((info.input.text as string).length > 30 ? "…" : "")
                : "";
            label = isComplete ? `Highlighted: "${snippet}"` : `Highlighting: "${snippet}"...`;
          } else if (info.toolName === "search_standard_ebooks") {
            const q = typeof info.input?.query === "string" ? info.input.query : "";
            if (isComplete && info.output?.books) {
              label = `Searched Standard Ebooks for "${q}" → ${(info.output.books as any[]).length} result${(info.output.books as any[]).length !== 1 ? "s" : ""}`;
            } else {
              label = `Searching Standard Ebooks for "${q}"...`;
            }
          }
          return (
            <div key={i} className="flex items-center gap-1.5 leading-tight">
              {isComplete ? (
                <span className="size-1 rounded-full bg-muted-foreground/50 shrink-0" />
              ) : (
                <span className="size-1.5 rounded-full bg-muted-foreground/70 animate-pulse shrink-0" />
              )}
              {label}
            </div>
          );
        })}
        {reasoningParts.map((part, i) => (
          <div key={`r-${i}`} className="italic leading-tight">
            {(part as any).text}
          </div>
        ))}
      </div>
    </details>
  );
}
