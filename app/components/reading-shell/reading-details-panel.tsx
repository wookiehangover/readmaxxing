import { type KeyboardEvent, useEffect } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { History, EllipsisIcon } from "lucide-react";
import { CoverImage } from "~/components/book-grid/cover-image";
import { CoverPlaceholder } from "~/components/book-grid/cover-placeholder";
import { openMobileReadingTab } from "~/components/reading-shell/mobile-reading-tabs";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Separator } from "~/components/ui/separator";
import { Table, TableBody, TableCell, TableRow } from "~/components/ui/table";
import { useSyncListener } from "~/hooks/use-sync-listener";
import { useWorkspace } from "~/lib/context/workspace-context";
import type { BookMeta } from "~/lib/stores/book-store";
import type { Bookmark as BookBookmark } from "~/lib/stores/bookmark-store";
import type { ReadingHistoryEntry } from "~/lib/stores/reading-history-store";
import { hydrateBookmarksRequested } from "~/lib/themis/bookmarks/bookmarks-slice";
import { useAppStore } from "~/lib/themis/provider";
import { hydrateReadingHistoryRequested } from "~/lib/themis/reading-positions/reading-positions-slice";
import { cn } from "~/lib/utils";

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatHistoryTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString(undefined, { timeStyle: "medium" });
}

function calendarDateKey(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function groupByCalendarDate<T>(items: T[], getTimestamp: (item: T) => number) {
  return items.reduce<{ key: string; timestamp: number; items: T[] }[]>((groups, item) => {
    const timestamp = getTimestamp(item);
    const key = calendarDateKey(timestamp);
    const currentGroup = groups.at(-1);

    if (currentGroup?.key === key) {
      currentGroup.items.push(item);
    } else {
      groups.push({ key, timestamp, items: [item] });
    }

    return groups;
  }, []);
}

function activateRowOnKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    event.currentTarget.click();
  }
}

function readingHistoryTarget(book: BookMeta, entry: ReadingHistoryEntry) {
  if (book.format === "pdf" && !entry.cfi.startsWith("page:") && entry.pageIndex !== null) {
    return `page:${entry.pageIndex}`;
  }
  return entry.cfi;
}

function bookmarkTarget(book: BookMeta, bookmark: BookBookmark) {
  if (book.format === "pdf") {
    const pageNumber = bookmark.pageNumber ?? bookmark.displayPage;
    if (pageNumber !== undefined) return `page:${pageNumber}`;
  }
  if (bookmark.cfi) return bookmark.cfi;
  if (bookmark.pageNumber !== undefined) return `page:${bookmark.pageNumber}`;
  return null;
}

export function ReadingDetailsPanel({
  book,
  mobile = false,
}: {
  book: BookMeta;
  mobile?: boolean;
}) {
  useSignals();

  const store = useAppStore();
  const workspace = useWorkspace();
  const bookmarkSyncVersion = useSyncListener(["bookmark"]);
  const readingHistory = store.readingPositionsSelectors.selectReadingHistory(book.id);
  const bookmarks = store.bookmarksSelectors.selectBookmarksByBook(book.id);

  useEffect(() => {
    store.dispatch(hydrateReadingHistoryRequested(book.id));
  }, [book.id, store]);

  useEffect(() => {
    store.dispatch(hydrateBookmarksRequested(book.id));
  }, [book.id, bookmarkSyncVersion, store]);

  async function navigateToLocation(target: string) {
    await workspace.navigateInCluster(book.id, target);
    if (mobile) openMobileReadingTab("Read", book.id);
  }

  const historyEntries = [...readingHistory.value].sort(
    (first, second) => second.timestamp - first.timestamp,
  );
  const savedBookmarks = [...bookmarks.value].sort(
    (first, second) => second.createdAt - first.createdAt,
  );
  const historyGroups = groupByCalendarDate(historyEntries, (entry) => entry.timestamp);
  const bookmarkGroups = groupByCalendarDate(savedBookmarks, (bookmark) => bookmark.createdAt);

  return (
    <ScrollArea className="h-full min-h-0 flex-1" hideScrollbar>
      <div
        className={cn("flex min-w-0 flex-col gap-6 pb-6 pr-6", {
          "px-6 pt-5": mobile,
        })}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-full max-w-40 overflow-hidden rounded-lg">
            {book.coverImage || book.remoteCoverUrl ? (
              <CoverImage
                coverImage={book.coverImage}
                alt={book.title}
                remoteCoverUrl={book.remoteCoverUrl}
                bookId={book.id}
                updatedAt={book.updatedAt}
              />
            ) : (
              <CoverPlaceholder title={book.title} author={book.author} />
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-sm font-medium text-foreground">{book.title}</h2>
            {book.author ? <p className="text-xs text-muted-foreground">{book.author}</p> : null}
          </div>
        </div>

        <Separator />

        <section
          aria-labelledby={`reading-history-${book.id}`}
          className="flex min-w-0 flex-col gap-2"
        >
          <h3 id={`reading-history-${book.id}`} className="text-xs font-medium text-foreground">
            Reading history
          </h3>
          {historyEntries.length > 0 ? (
            <div data-testid="reading-history-table-scroll" className="max-h-72 overflow-y-auto">
              <div className="flex flex-col gap-3">
                {historyGroups.map((group) => {
                  const dateLabel = formatDate(group.timestamp);

                  return (
                    <div key={group.key} className="flex flex-col">
                      <h4 className="text-xs font-normal text-muted-foreground sticky top-0 bg-background/80 backdrop-blur z-10 pl-2 pb-1">{dateLabel}</h4>
                      <Table
                        aria-label={`Reading history for ${dateLabel}`}
                        className="table-fixed text-xs"
                      >
                        <TableBody>
                          {group.items.map((entry) => (
                            <TableRow
                              key={entry.id}
                              className="cursor-pointer border-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
                              tabIndex={0}
                              onClick={() =>
                                void navigateToLocation(readingHistoryTarget(book, entry))
                              }
                              onKeyDown={activateRowOnKeyDown}
                            >
                              <TableCell className="w-[38%] max-w-0 py-1.5 font-medium">
                                <span className="block truncate">
                                  {entry.chapterLabel ?? "Saved location"}
                                </span>
                              </TableCell>
                              <TableCell className="w-[30%] py-1.5 text-muted-foreground">
                                {entry.pageIndex !== null
                                  ? `${entry.pageIndex}${entry.totalPages != null ? ` / ${entry.totalPages}` : ""}`
                                  : "—"}
                              </TableCell>
                              <TableCell className="w-[32%] py-1.5 whitespace-normal text-muted-foreground">
                                <time dateTime={new Date(entry.timestamp).toISOString()}>
                                  {formatHistoryTime(entry.timestamp)}
                                </time>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <Empty className="min-h-0 flex-none p-3">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <History aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>No reading history yet</EmptyTitle>
                <EmptyDescription>Locations will appear as you read.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </section>

        <Separator />

        <section aria-labelledby={`bookmarks-${book.id}`} className="flex min-w-0 flex-col gap-2">
          <h3 id={`bookmarks-${book.id}`} className="text-xs font-medium text-foreground">
            Bookmarks
          </h3>
          {savedBookmarks.length > 0 ? (
            <div data-testid="bookmarks-table-scroll" className="max-h-88 overflow-y-auto">
              <div className="flex flex-col gap-3">
                {bookmarkGroups.map((group) => {
                  const dateLabel = formatDate(group.timestamp);

                  return (
                    <div key={group.key} className="flex flex-col gap-1">
                      <h4 className="text-xs font-normal text-muted-foreground">{dateLabel}</h4>
                      <Table
                        aria-label={`Bookmarks for ${dateLabel}`}
                        className="table-fixed text-xs"
                      >
                        <TableBody>
                          {group.items.map((bookmark) => {
                            const target = bookmarkTarget(book, bookmark);
                            const pageNumber =
                              book.format === "pdf"
                                ? (bookmark.pageNumber ?? bookmark.displayPage)
                                : (bookmark.displayPage ?? bookmark.pageNumber);
                            const locationLabel =
                              bookmark.label && bookmark.label !== `Page ${pageNumber}`
                                ? bookmark.label
                                : "Saved location";

                            return (
                              <TableRow
                                key={bookmark.id}
                                className={cn(
                                  "border-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none",
                                  {
                                    "cursor-pointer": target,
                                    "cursor-default opacity-50": !target,
                                  },
                                )}
                                aria-disabled={!target}
                                tabIndex={target ? 0 : undefined}
                                onClick={target ? () => void navigateToLocation(target) : undefined}
                                onKeyDown={target ? activateRowOnKeyDown : undefined}
                              >
                                <TableCell className="w-[70%] max-w-0 py-1.5 font-medium">
                                  <span className="block truncate">{locationLabel}</span>
                                </TableCell>
                                <TableCell className="w-[30%] py-1.5 text-muted-foreground">
                                  {pageNumber ?? "—"}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex justify-center py-4">
                <p className="flex items-center gap-1 text-xs text-muted-foreground/50">
                  <span className="aspect-square p-1 border rounded-sm">
                    <EllipsisIcon className="size-3" />
                  </span>
                  <span>→</span>
                  <span>Actions</span>
                  <span>→</span>
                  <span>Bookmark page</span>
                </p>
            </div>
          )}
        </section>
      </div>
    </ScrollArea>
  );
}
