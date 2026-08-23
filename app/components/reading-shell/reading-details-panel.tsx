import { type KeyboardEvent, useEffect } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { Bookmark, History } from "lucide-react";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
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

function formatHistoryTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "medium",
  });
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
            <div
              data-testid="reading-history-table-scroll"
              className="max-h-88 overflow-y-auto rounded-md border"
            >
              <Table aria-label="Reading history" className="table-fixed text-xs">
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="h-8 w-[38%]">Location</TableHead>
                    <TableHead className="h-8 w-[30%]">Page · progress</TableHead>
                    <TableHead className="h-8 w-[32%]">Visited</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyEntries.map((entry) => {
                    const locationDetails = [
                      entry.pageIndex !== null
                        ? `${entry.pageIndex}${entry.totalPages != null ? ` / ${entry.totalPages}` : ""}`
                        : null,
                      `${Math.round(entry.percentage)}%`,
                    ].filter(Boolean);

                    return (
                      <TableRow
                        key={entry.id}
                        className="cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
                        tabIndex={0}
                        onClick={() => void navigateToLocation(readingHistoryTarget(book, entry))}
                        onKeyDown={activateRowOnKeyDown}
                      >
                        <TableCell className="max-w-0 py-1.5 font-medium">
                          <span className="block truncate">
                            {entry.chapterLabel ?? "Saved location"}
                          </span>
                        </TableCell>
                        <TableCell className="py-1.5 text-muted-foreground">
                          {locationDetails.join(" · ")}
                        </TableCell>
                        <TableCell className="py-1.5 whitespace-normal text-muted-foreground">
                          <time dateTime={new Date(entry.timestamp).toISOString()}>
                            {formatHistoryTimestamp(entry.timestamp)}
                          </time>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
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
            <div
              data-testid="bookmarks-table-scroll"
              className="max-h-88 overflow-y-auto rounded-md border"
            >
              <Table aria-label="Bookmarks" className="table-fixed text-xs">
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="h-8 w-[46%]">Location</TableHead>
                    <TableHead className="h-8 w-[18%]">Page</TableHead>
                    <TableHead className="h-8 w-[36%]">Saved</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {savedBookmarks.map((bookmark) => {
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
                          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none",
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
                        <TableCell className="max-w-0 py-1.5 font-medium">
                          <span className="block truncate">{locationLabel}</span>
                        </TableCell>
                        <TableCell className="py-1.5 text-muted-foreground">
                          {pageNumber ?? "—"}
                        </TableCell>
                        <TableCell className="py-1.5 whitespace-normal text-muted-foreground">
                          <time dateTime={new Date(bookmark.createdAt).toISOString()}>
                            {formatDate(bookmark.createdAt)}
                          </time>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <Empty className="min-h-0 flex-none p-3">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Bookmark aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>No bookmarks yet</EmptyTitle>
                <EmptyDescription>Save a page to find it again here.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </section>
      </div>
    </ScrollArea>
  );
}
