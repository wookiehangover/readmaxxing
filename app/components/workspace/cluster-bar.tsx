import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { BookCover } from "~/components/book-list";
import { cn } from "~/lib/utils";
import { useWorkspace } from "~/lib/context/workspace-context";
import type { BookMeta } from "~/lib/stores/book-store";

export interface ClusterBarEntry {
  readonly bookId: string;
  readonly bookTitle: string;
}

interface ClusterBarProps {
  /** Ordered list of open cluster book IDs (session-scoped). */
  readonly getEntries: () => ClusterBarEntry[];
  /** Currently-active cluster book ID, or null if none. */
  readonly getActiveId: () => string | null;
  /** Activate the Nth cluster (bookId), triggering a swap in focused mode. */
  readonly onActivate: (bookId: string) => void;
  /** Close the cluster for `bookId` (remove pill; may swap active if needed). */
  readonly onClose: (bookId: string) => void;
}

/**
 * Horizontal pill bar for switching between open focused-mode clusters.
 * Each pill shows a cover thumbnail + truncated title and is clickable.
 * An X button on hover closes the cluster. Subscribes to cluster-change
 * notifications to re-render when clusters are added/removed/activated.
 */
export function ClusterBar({ getEntries, getActiveId, onActivate, onClose }: ClusterBarProps) {
  const { subscribeClusterChanges, booksRef } = useWorkspace();
  const [, setVersion] = useState(0);

  useEffect(() => {
    return subscribeClusterChanges(() => setVersion((v) => v + 1));
  }, [subscribeClusterChanges]);

  const entries = getEntries();
  const activeId = getActiveId();

  if (entries.length === 0) return null;

  const bookById = new Map<string, BookMeta>();
  for (const b of booksRef.current) bookById.set(b.id, b);

  return (
    <div
      role="tablist"
      aria-label="Open books"
      className="flex items-center gap-1.5 overflow-x-auto border-b border-border/60 bg-background px-2 py-1.5"
    >
      {entries.map((entry, idx) => {
        const isActive = entry.bookId === activeId;
        const book = bookById.get(entry.bookId);
        const shortcut = idx < 9 ? `⌘${idx + 1}` : undefined;
        return (
          <div
            key={entry.bookId}
            className={cn(
              "group relative flex shrink-0 items-center gap-1 rounded-md border pl-1 pr-1 py-1 text-xs transition-colors",
              {
                "border-primary/40 bg-primary/10 text-foreground": isActive,
                "border-border/50 bg-card/40 text-muted-foreground hover:bg-card/80 hover:text-foreground":
                  !isActive,
              },
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              title={entry.bookTitle + (shortcut ? ` (${shortcut})` : "")}
              onClick={() => onActivate(entry.bookId)}
              className="flex min-w-0 items-center gap-1.5 rounded px-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {book?.coverImage || book?.remoteCoverUrl ? (
                <div className="h-6 w-4 shrink-0 overflow-hidden rounded-sm">
                  <BookCover
                    coverImage={book.coverImage}
                    remoteCoverUrl={book.remoteCoverUrl}
                    bookId={book.id}
                  />
                </div>
              ) : (
                <div className="flex h-6 w-4 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px]">
                  📖
                </div>
              )}
              <span className="max-w-[14ch] truncate font-medium">{entry.bookTitle}</span>
              {shortcut && (
                <span className="ml-1 hidden text-[10px] text-muted-foreground/70 tabular-nums md:inline">
                  {shortcut}
                </span>
              )}
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="size-5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onClose(entry.bookId);
              }}
              title="Close cluster"
              aria-label={`Close ${entry.bookTitle}`}
            >
              <X className="size-3" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
