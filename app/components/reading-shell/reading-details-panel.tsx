import { useEffect } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { Bookmark, History } from "lucide-react";

import { CoverImage } from "~/components/book-grid/cover-image";
import { CoverPlaceholder } from "~/components/book-grid/cover-placeholder";
import { openMobileReadingTab } from "~/components/reading-shell/mobile-reading-tabs";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Separator } from "~/components/ui/separator";
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

function readingHistoryTarget(book: BookMeta, entry: ReadingHistoryEntry) {
  if (book.format === "pdf" && !entry.cfi.startsWith("page:") && entry.pageIndex !== null) {
    return `page:${entry.pageIndex}`;
  }
  return entry.cfi;
}

function bookmarkTarget(bookmark: BookBookmark) {
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
            <ul className="flex min-w-0 flex-col gap-1">
              {historyEntries.map((entry) => {
                const locationDetails = [
                  entry.pageIndex !== null
                    ? `Page ${entry.pageIndex}${entry.totalPages !== null ? ` of ${entry.totalPages}` : ""}`
                    : null,
                  `${Math.round(entry.percentage)}%`,
                ].filter(Boolean);

                return (
                  <li key={entry.id}>
                    <Button
                      variant="ghost"
                      className="h-auto w-full items-start justify-start whitespace-normal px-2 py-2 text-left"
                      onClick={() => void navigateToLocation(readingHistoryTarget(book, entry))}
                    >
                      <History data-icon="inline-start" aria-hidden="true" />
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="truncate">
                          {entry.chapterLabel ??
                            (entry.pageIndex !== null
                              ? `Page ${entry.pageIndex}`
                              : "Saved location")}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {locationDetails.join(" · ")}
                        </span>
                        <time
                          dateTime={new Date(entry.timestamp).toISOString()}
                          className="text-xs text-muted-foreground"
                        >
                          {formatDate(entry.timestamp)}
                        </time>
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ul>
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
            <ul className="flex min-w-0 flex-col gap-1">
              {savedBookmarks.map((bookmark) => {
                const target = bookmarkTarget(bookmark);
                const pageNumber =
                  book.format === "pdf"
                    ? (bookmark.pageNumber ?? bookmark.displayPage)
                    : (bookmark.displayPage ?? bookmark.pageNumber);

                return (
                  <li key={bookmark.id}>
                    <Button
                      variant="ghost"
                      className="h-auto w-full items-start justify-start whitespace-normal px-2 py-2 text-left"
                      disabled={!target}
                      onClick={() => {
                        if (target) void navigateToLocation(target);
                      }}
                    >
                      <Bookmark data-icon="inline-start" aria-hidden="true" />
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="truncate">
                          {bookmark.label ??
                            (pageNumber !== undefined ? `Page ${pageNumber}` : "Saved bookmark")}
                        </span>
                        {pageNumber !== undefined && bookmark.label !== `Page ${pageNumber}` ? (
                          <span className="text-xs text-muted-foreground">Page {pageNumber}</span>
                        ) : null}
                        <time
                          dateTime={new Date(bookmark.createdAt).toISOString()}
                          className="text-xs text-muted-foreground"
                        >
                          {formatDate(bookmark.createdAt)}
                        </time>
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ul>
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
