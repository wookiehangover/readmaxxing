import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "~/lib/utils";
import { getToolInfo } from "./chat-utils";

interface SearchHit {
  chapterIndex?: number;
  chapterTitle?: string;
  excerpt?: string;
}

function getSearchResults(output: any): SearchHit[] | null {
  if (Array.isArray(output)) return output;
  if (Array.isArray(output?.results)) return output.results;
  return null;
}

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

function buildStepsSummary(
  toolParts: any[],
  resolveBookTitle: (id: string | undefined) => string | undefined,
  showBookLabel: boolean,
): string {
  const SEARCH_KEY = "__search__";
  const order: string[] = [];
  const counts = new Map<string, number>();
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
      const count = counts.get(key) ?? 1;
      return count > 1 ? `${key} (${count}×)` : key;
    })
    .join(", ");
}

export function ToolStepsDetails({
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
      <summary className="flex cursor-pointer list-none items-center gap-1 font-mono text-[11px] text-muted-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
        {buildStepsSummary(toolParts, resolveBookTitle, showBookLabel)}
        {toolParts.length > 0 && ` → ${toolParts.length} step${toolParts.length > 1 ? "s" : ""}`}
        {reasoningParts.length > 0 && toolParts.length === 0 && "Reasoning"}
      </summary>
      <div
        className={cn("mt-1 space-y-0.5 pl-4 font-mono text-[11px] text-muted-foreground", {
          "max-h-[4.5rem] overflow-y-auto": isStreaming,
        })}
      >
        {toolParts.map((part, i) => {
          const info = getToolInfo(part);
          if (!info) return null;
          const isComplete = info.state === "output-available";

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
            label =
              isComplete && (info.output as any)?.text
                ? `Read ${title} → ${(info.output as any).text.length.toLocaleString()} chars`
                : `Reading ${title}...`;
          } else if (info.toolName === "read_notes") {
            label = isComplete ? "Read notebook" : "Reading notebook...";
          } else if (info.toolName === "append_to_notes") {
            label = isComplete ? "Added to notebook" : "Adding to notebook...";
          } else if (info.toolName === "edit_notes") {
            if (isComplete) {
              const error =
                typeof info.output?.error === "string" ? info.output.error : "unknown error";
              label =
                info.output?.executed === false
                  ? `Failed to edit notebook: ${error}`
                  : "Edited notebook";
            } else {
              label = "Editing notebook...";
            }
          } else if (info.toolName === "create_highlight") {
            const text = typeof info.input?.text === "string" ? info.input.text : "";
            const snippet = text.slice(0, 30) + (text.length > 30 ? "…" : "");
            label = isComplete ? `Highlighted: "${snippet}"` : `Highlighting: "${snippet}"...`;
          } else if (info.toolName === "search_standard_ebooks") {
            const query = typeof info.input?.query === "string" ? info.input.query : "";
            const books = Array.isArray(info.output?.books) ? info.output.books : null;
            label =
              isComplete && books
                ? `Searched Standard Ebooks for "${query}" → ${books.length} result${books.length !== 1 ? "s" : ""}`
                : `Searching Standard Ebooks for "${query}"...`;
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
                  className={cn("size-1 shrink-0 rounded-full", {
                    "bg-destructive": isFailed,
                    "bg-muted-foreground/50": !isFailed,
                  })}
                />
              ) : (
                <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground/70" />
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
  const target = bookTitle ?? "book";
  const label =
    isComplete && results
      ? `Searched ${target} for "${query}" → ${results.length} result${results.length !== 1 ? "s" : ""}`
      : `Searching ${target} for "${query}"...`;
  const canExpand = isComplete && results !== null && results.length > 0;
  const dot = isComplete ? (
    <span className="size-1 shrink-0 rounded-full bg-muted-foreground/50" />
  ) : (
    <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground/70" />
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
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full cursor-pointer items-center gap-1.5 text-left transition-colors hover:text-foreground/80"
      >
        <ChevronRight
          className={cn("size-3 shrink-0 transition-transform", { "rotate-90": expanded })}
        />
        {label}
      </button>
      {expanded && (
        <ul className="mt-0.5 ml-4 space-y-1">
          {results.map((hit, index) => (
            <li key={index} className="border-l border-muted-foreground/20 pl-2">
              <div className="text-muted-foreground/80">
                {hit.chapterTitle ?? `Chapter ${hit.chapterIndex ?? "?"}`}
              </div>
              {hit.excerpt && <div className="text-muted-foreground/60">{hit.excerpt}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
