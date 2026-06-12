import { memo, useCallback, useMemo, useState } from "react";
import type { UIMessage } from "@ai-sdk/react";
import { ChevronRight } from "lucide-react";
import { Streamdown } from "streamdown";
import type { Components } from "streamdown";
import type { SEBook } from "~/lib/standard-ebooks";
import { cn } from "~/lib/utils";
import { useWorkspace } from "~/lib/context/workspace-context";
import { getToolInfo, joinTextParts, stripSuggestedPrompts } from "./chat-utils";
import { SEBookCardsInChat } from "./se-book-cards";

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
  const { navigateInCluster, findTocForBook, applyTempHighlightForBook, booksRef } = useWorkspace();

  // Resolve a book id to its title via the workspace books list. Falls back to
  // the chat's own/primary book when the id is absent (back-compat with the
  // old search_book output shape) or unknown.
  const resolveBookTitle = useCallback(
    (id: string | undefined): string | undefined => {
      const targetId = id ?? bookId;
      return booksRef.current.find((b) => b.id === targetId)?.title;
    },
    [booksRef, bookId],
  );

  // Whether more than one book is currently in the workspace. When only one
  // book is in play the per-search book label can stay subtle/omitted.
  const hasMultipleBooks = booksRef.current.length > 1;

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
              const doc = await pdfjs.getDocument({ data: dataCopy }).promise;
              try {
                const results = await searchPdf(doc, queryStr);
                if (results.length > 0) {
                  await navigateInCluster(bookId, `page:${results[0].page}`);
                  return;
                }
              } finally {
                await doc.destroy();
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
              const ePub = (await import("epubjs")).default;
              const { fuzzySearchBookForCfi } = await import("~/lib/epub/epub-search");
              const book = ePub(data.slice(0));
              try {
                const results = await fuzzySearchBookForCfi(book, queryStr);

                if (results.length > 0) {
                  const cfi = results[0].cfi;
                  await navigateInCluster(bookId, cfi);
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
            resolveBookTitle={resolveBookTitle}
            showBookLabel={hasMultipleBooks}
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

/**
 * Memoized: the chat panel re-renders on every streamed token, and without
 * memoization every historical message re-runs its text joins and re-renders
 * its Streamdown markdown tree per token. `useChat` keeps stable references
 * for messages that haven't changed (only the streaming message is replaced
 * each update), so a shallow prop compare skips all settled messages.
 */
export const ChatMessage = memo(ChatMessageImpl);

interface SearchHit {
  chapterIndex?: number;
  chapterTitle?: string;
  excerpt?: string;
}

/** Normalize a search_book tool output into its results array, staying
 *  back-compatible with the old shape where `output` was the array directly. */
function getSearchResults(output: any): SearchHit[] | null {
  if (Array.isArray(output)) return output;
  if (Array.isArray(output?.results)) return output.results;
  return null;
}

/** Map a non-search tool part to its display label for the summary line. */
function nonSearchLabel(info: { toolName: string; output?: any }): string {
  switch (info.toolName) {
    case "read_chapter":
      return "Read chapter";
    case "read_notes":
      return "Read notebook";
    case "append_to_notes":
      return "Added to notebook";
    case "edit_notes":
      return info.output?.executed === false ? "Failed to edit notebook" : "Edited notebook";
    case "create_highlight":
      return "Highlighted";
    case "search_standard_ebooks":
      return "Searched Standard Ebooks";
    default:
      return info.toolName;
  }
}

/**
 * Build a condensed, deduped summary string for the tool-steps `<summary>`.
 * Collapses all `search_book` calls into one entry (distinct books + total
 * count) and dedupes other repeated actions with a "(K×)" multiplier, in
 * first-occurrence order.
 */
function buildStepsSummary(
  toolParts: any[],
  resolveBookTitle: (id: string | undefined) => string | undefined,
  showBookLabel: boolean,
): string {
  // Tracks first-occurrence order of entries. Searches are folded into a
  // single synthetic key so they appear once at their first position.
  const SEARCH_KEY = "__search__";
  const order: string[] = [];
  const counts = new Map<string, number>();
  // Distinct searched book titles, in first-seen order.
  const searchBooks: string[] = [];
  let searchTotal = 0;

  for (const part of toolParts) {
    const info = getToolInfo(part);
    if (!info) continue;
    if (info.toolName === "search_book") {
      searchTotal += 1;
      if (showBookLabel) {
        const title = resolveBookTitle(info.output?.bookId as string | undefined);
        if (title && !searchBooks.includes(title)) searchBooks.push(title);
      }
      if (!counts.has(SEARCH_KEY)) order.push(SEARCH_KEY);
      counts.set(SEARCH_KEY, searchTotal);
      continue;
    }
    const label = nonSearchLabel(info);
    if (!counts.has(label)) order.push(label);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return order
    .map((key) => {
      if (key === SEARCH_KEY) {
        // Choose the cleaner book phrasing: ≤2 distinct titles -> join with
        // " & "; 3+ -> "N books". Fall back to "book(s)" when titles unknown.
        let target: string;
        if (searchBooks.length === 0) {
          target = searchTotal > 1 ? "books" : "book";
        } else if (searchBooks.length <= 2) {
          target = searchBooks.join(" & ");
        } else {
          target = `${searchBooks.length} books`;
        }
        const times = searchTotal > 1 ? ` (${searchTotal}×)` : "";
        return `Searched ${target}${times}`;
      }
      const n = counts.get(key) ?? 1;
      return n > 1 ? `${key} (${n}×)` : key;
    })
    .join(", ");
}

function ToolStepsDetails({
  toolParts,
  reasoningParts,
  isStreaming,
  resolveBookTitle,
  showBookLabel,
}: {
  toolParts: any[];
  reasoningParts: any[];
  isStreaming?: boolean;
  resolveBookTitle: (id: string | undefined) => string | undefined;
  showBookLabel: boolean;
}) {
  return (
    <details className="group mb-5 -ml-4" open={isStreaming || undefined}>
      <summary className="cursor-pointer text-[11px] text-muted-foreground font-mono flex items-center gap-1 list-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
        {buildStepsSummary(toolParts, resolveBookTitle, showBookLabel)}
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

          // search_book renders its own expandable disclosure so the user can
          // reveal the matched passages and see which book was searched.
          if (info.toolName === "search_book") {
            return (
              <SearchBookStep
                key={i}
                info={info}
                isComplete={isComplete}
                resolveBookTitle={resolveBookTitle}
                showBookLabel={showBookLabel}
              />
            );
          }

          let label = info.toolName;
          if (info.toolName === "read_chapter") {
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
          } else if (info.toolName === "edit_notes") {
            if (isComplete) {
              if (info.output?.executed === false) {
                const errMsg =
                  typeof info.output?.error === "string" ? info.output.error : "unknown error";
                label = `Failed to edit notebook: ${errMsg}`;
              } else {
                label = "Edited notebook";
              }
            } else {
              label = "Editing notebook...";
            }
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
          const isFailed = isComplete && info.output?.executed === false;
          return (
            <div
              key={i}
              className={cn("flex items-center gap-1.5 leading-tight", {
                "text-destructive": isFailed,
              })}
            >
              {isComplete ? (
                <span
                  className={cn("size-1 rounded-full shrink-0", {
                    "bg-destructive": isFailed,
                    "bg-muted-foreground/50": !isFailed,
                  })}
                />
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

/** A single `search_book` tool step. Shows which book was searched and, when
 *  complete with results, is individually expandable to reveal the matched
 *  passages (chapter title + excerpt). */
function SearchBookStep({
  info,
  isComplete,
  resolveBookTitle,
  showBookLabel,
}: {
  info: { input?: Record<string, unknown>; output?: any };
  isComplete: boolean;
  resolveBookTitle: (id: string | undefined) => string | undefined;
  showBookLabel: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const query = typeof info.input?.query === "string" ? info.input.query : "";
  const results = getSearchResults(info.output);
  const bookTitle = showBookLabel
    ? resolveBookTitle(info.output?.bookId as string | undefined)
    : undefined;
  const target = bookTitle ? bookTitle : "book";

  let label: string;
  if (isComplete && results) {
    label = `Searched ${target} for "${query}" → ${results.length} result${results.length !== 1 ? "s" : ""}`;
  } else {
    label = `Searching ${target} for "${query}"...`;
  }

  const canExpand = isComplete && results !== null && results.length > 0;

  const dot = isComplete ? (
    <span className="size-1 rounded-full shrink-0 bg-muted-foreground/50" />
  ) : (
    <span className="size-1.5 rounded-full bg-muted-foreground/70 animate-pulse shrink-0" />
  );

  if (!canExpand) {
    return (
      <div className="flex items-center gap-1.5 leading-tight">
        {dot}
        {label}
      </div>
    );
  }

  return (
    <div className="leading-tight">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex items-center gap-1.5 w-full text-left cursor-pointer hover:text-foreground/80 transition-colors"
      >
        <ChevronRight
          className={cn("size-3 shrink-0 transition-transform", { "rotate-90": expanded })}
        />
        {label}
      </button>
      {expanded && (
        <ul className="mt-0.5 ml-4 space-y-1">
          {results.map((hit, j) => (
            <li key={j} className="border-l border-muted-foreground/20 pl-2">
              <div className="text-muted-foreground/80">
                {hit.chapterTitle ? hit.chapterTitle : `Chapter ${hit.chapterIndex ?? "?"}`}
              </div>
              {hit.excerpt && <div className="text-muted-foreground/60">{hit.excerpt}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
