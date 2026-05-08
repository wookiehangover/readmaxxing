import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
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
  /** Persist a reordered list of cluster book IDs. */
  readonly onReorder: (newOrder: string[]) => void;
}

type DropPosition = "before" | "after";

interface DropIndicator {
  readonly targetBookId: string;
  readonly position: DropPosition;
}

function getReorderedIds(
  entries: ClusterBarEntry[],
  draggedBookId: string,
  targetBookId: string,
  position: DropPosition,
): string[] | null {
  if (draggedBookId === targetBookId) return null;

  const current = entries.map((entry) => entry.bookId);
  if (!current.includes(draggedBookId) || !current.includes(targetBookId)) return null;

  const next = current.filter((bookId) => bookId !== draggedBookId);
  const targetIndex = next.indexOf(targetBookId);
  if (targetIndex === -1) return null;

  next.splice(position === "before" ? targetIndex : targetIndex + 1, 0, draggedBookId);
  return current.every((bookId, idx) => bookId === next[idx]) ? null : next;
}

/**
 * Horizontal pill bar for switching between open focused-mode clusters.
 * Each pill shows a cover thumbnail + truncated title and is clickable.
 * An X button on hover closes the cluster. Subscribes to cluster-change
 * notifications to re-render when clusters are added/removed/activated.
 */
export function ClusterBar({
  getEntries,
  getActiveId,
  onActivate,
  onClose,
  onReorder,
}: ClusterBarProps) {
  const { subscribeClusterChanges, booksRef } = useWorkspace();
  const [, setVersion] = useState(0);
  const [draggedBookId, setDraggedBookId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingKeyboardFocusBookIdRef = useRef<string | null>(null);

  useEffect(() => {
    return subscribeClusterChanges(() => setVersion((v) => v + 1));
  }, [subscribeClusterChanges]);

  const entries = getEntries();
  const activeId = getActiveId();
  const entryOrderKey = entries.map((entry) => entry.bookId).join("\u0000");

  useEffect(() => {
    const bookId = pendingKeyboardFocusBookIdRef.current;
    if (!bookId) return;

    pendingKeyboardFocusBookIdRef.current = null;
    buttonRefs.current.get(bookId)?.focus();
  }, [entryOrderKey]);

  function clearDragState() {
    setDraggedBookId(null);
    setDropIndicator(null);
  }

  function handleDragStart(bookId: string, event: DragEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement | null)?.closest("[data-cluster-close]")) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", bookId);
    setDraggedBookId(bookId);
  }

  function handleDragOver(targetBookId: string, event: DragEvent<HTMLDivElement>) {
    if (!draggedBookId) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    if (draggedBookId === targetBookId) {
      setDropIndicator(null);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const position: DropPosition = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
    setDropIndicator({ targetBookId, position });
  }

  function handleDrop(targetBookId: string, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();

    const sourceBookId = event.dataTransfer.getData("text/plain") || draggedBookId;
    const rect = event.currentTarget.getBoundingClientRect();
    const position: DropPosition = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
    const next = sourceBookId
      ? getReorderedIds(entries, sourceBookId, targetBookId, position)
      : null;
    if (next) onReorder(next);

    clearDragState();
  }

  function handleKeyDown(
    entry: ClusterBarEntry,
    idx: number,
    event: KeyboardEvent<HTMLButtonElement>,
  ) {
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    const targetIndex = idx + (event.key === "ArrowLeft" ? -1 : 1);
    if (targetIndex < 0 || targetIndex >= entries.length) return;

    event.preventDefault();
    event.stopPropagation();

    const next = entries.map((item) => item.bookId);
    [next[idx], next[targetIndex]] = [next[targetIndex], next[idx]];
    pendingKeyboardFocusBookIdRef.current = entry.bookId;
    onReorder(next);
  }

  if (entries.length === 0) return null;

  const bookById = new Map<string, BookMeta>();
  for (const b of booksRef.current) bookById.set(b.id, b);

  return (
    <div
      role="tablist"
      aria-label="Open books"
      className="flex items-center gap-1.5 overflow-x-auto h-11 border-b border-border/60 bg-background px-2 py-1.5"
    >
      {entries.map((entry, idx) => {
        const isActive = entry.bookId === activeId;
        const book = bookById.get(entry.bookId);
        const shortcut = idx < 9 ? `⌘${idx + 1}` : undefined;
        const indicatorPosition =
          dropIndicator?.targetBookId === entry.bookId ? dropIndicator.position : null;
        return (
          <div
            key={entry.bookId}
            draggable
            onDragStart={(event) => handleDragStart(entry.bookId, event)}
            onDragOver={(event) => handleDragOver(entry.bookId, event)}
            onDrop={(event) => handleDrop(entry.bookId, event)}
            onDragEnd={clearDragState}
            className={cn(
              "group relative flex shrink-0 cursor-grab items-center gap-1 rounded-md border pl-1 pr-1 py-1 text-xs transition-colors",
              {
                "border-primary/40 bg-primary/10 text-foreground": isActive,
                "border-border/50 bg-card/40 text-muted-foreground hover:bg-card/80 hover:text-foreground":
                  !isActive,
                "cursor-grabbing opacity-50": draggedBookId === entry.bookId,
              },
            )}
          >
            {indicatorPosition && draggedBookId && (
              <span
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute inset-y-0 w-0.5 rounded-full bg-primary",
                  {
                    "left-0": indicatorPosition === "before",
                    "right-0": indicatorPosition === "after",
                  },
                )}
              />
            )}
            <button
              ref={(node) => {
                if (node) buttonRefs.current.set(entry.bookId, node);
                else buttonRefs.current.delete(entry.bookId);
              }}
              type="button"
              role="tab"
              aria-selected={isActive}
              title={entry.bookTitle + (shortcut ? ` (${shortcut})` : "")}
              onClick={() => onActivate(entry.bookId)}
              onKeyDown={(event) => handleKeyDown(entry, idx, event)}
              className="flex min-w-0 items-center gap-1.5 rounded px-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {book?.coverImage || book?.remoteCoverUrl ? (
                <div className="h-6 w-4 shrink-0 overflow-hidden rounded-sm">
                  <BookCover
                    coverImage={book.coverImage}
                    remoteCoverUrl={book.remoteCoverUrl}
                    bookId={book.id}
                    updatedAt={book.updatedAt}
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
              data-cluster-close
              draggable={false}
              variant="ghost"
              size="icon"
              className="size-5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onClose(entry.bookId);
              }}
              onDragStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
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
