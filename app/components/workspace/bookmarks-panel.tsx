import { useCallback, useMemo, useState } from "react";
import { Effect } from "effect";
import type { IDockviewPanelProps } from "dockview";
import { Bookmark as BookmarkIcon, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { ScrollArea } from "~/components/ui/scroll-area";
import { useEffectQuery } from "~/hooks/use-effect-query";
import { useSyncListener } from "~/hooks/use-sync-listener";
import { useWorkspace } from "~/lib/context/workspace-context";
import { AppRuntime } from "~/lib/effect-runtime";
import { BookmarkService, type Bookmark } from "~/lib/stores/bookmark-store";

interface BookmarksPanelParams {
  readonly bookId: string;
  readonly bookTitle: string;
}

interface GroupedBookmarks {
  readonly key: string;
  readonly label: string;
  readonly bookmarks: Bookmark[];
}

function formatCreatedAt(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function groupBookmarksByChapter(bookmarks: Bookmark[]): GroupedBookmarks[] {
  const groups = new Map<string, GroupedBookmarks>();

  for (const bookmark of bookmarks) {
    const label = bookmark.label ?? "Unknown chapter";
    const group = groups.get(label);
    if (group) {
      group.bookmarks.push(bookmark);
    } else {
      groups.set(label, { key: label, label, bookmarks: [bookmark] });
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      bookmarks: [...group.bookmarks].sort((a, b) => b.createdAt - a.createdAt),
    }))
    .sort((a, b) => (b.bookmarks[0]?.createdAt ?? 0) - (a.bookmarks[0]?.createdAt ?? 0));
}

export function BookmarksPanel({ params }: IDockviewPanelProps<BookmarksPanelParams>) {
  const { bookId, bookTitle } = params;
  const { navigateInCluster } = useWorkspace();
  const syncVersion = useSyncListener(["bookmark"]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isClearing, setIsClearing] = useState(false);

  const {
    data: bookmarks,
    error,
    isLoading,
  } = useEffectQuery(
    () =>
      BookmarkService.pipe(
        Effect.andThen((s) => s.getBookmarksByBook(bookId)),
        Effect.catchAll((error) =>
          Effect.sync(() => {
            console.error("Failed to load bookmarks:", error);
            return [] as Bookmark[];
          }),
        ),
      ),
    [bookId, refreshKey, syncVersion],
  );

  const entries = bookmarks ?? [];
  const groupedBookmarks = useMemo(() => groupBookmarksByChapter(entries), [entries]);

  const handleClearBookmarks = useCallback(() => {
    if (entries.length === 0 || isClearing) return;
    if (!window.confirm(`Clear all bookmarks for "${bookTitle}"?`)) return;

    setIsClearing(true);
    const program = Effect.gen(function* () {
      const service = yield* BookmarkService;
      yield* Effect.forEach(entries, (bookmark) => service.deleteBookmark(bookmark.id));
      return true;
    }).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          console.error("Failed to clear bookmarks:", error);
          return false;
        }),
      ),
      Effect.ensuring(Effect.sync(() => setIsClearing(false))),
    );

    AppRuntime.runPromise(program)
      .then((cleared) => {
        if (!cleared) return;
        setRefreshKey((key) => key + 1);
        queueMicrotask(() => {
          window.dispatchEvent(
            new CustomEvent("sync:entity-updated", { detail: { entity: "bookmark" } }),
          );
        });
      })
      .catch(console.error);
  }, [bookTitle, entries, isClearing]);

  const handleNavigateToBookmark = useCallback(
    (cfi: string) => {
      navigateInCluster(bookId, cfi).catch((err: unknown) => {
        console.error("Failed to navigate from bookmarks:", err);
      });
    },
    [bookId, navigateInCluster],
  );

  const handleDeleteBookmark = useCallback((bookmarkId: string) => {
    AppRuntime.runPromise(BookmarkService.pipe(Effect.andThen((s) => s.deleteBookmark(bookmarkId))))
      .then(() => {
        setRefreshKey((key) => key + 1);
        queueMicrotask(() => {
          window.dispatchEvent(
            new CustomEvent("sync:entity-updated", { detail: { entity: "bookmark" } }),
          );
        });
      })
      .catch(console.error);
  }, []);

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="truncate text-sm font-semibold">Bookmarks</h2>
        <p className="truncate text-xs text-muted-foreground">{bookTitle}</p>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {isLoading ? (
          <div className="flex h-full items-center justify-center p-6">
            <p className="text-sm text-muted-foreground">Loading bookmarks…</p>
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center p-6">
            <p className="text-sm text-muted-foreground">Unable to load bookmarks.</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <BookmarkIcon className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">No bookmarks yet</p>
            <p className="text-xs text-muted-foreground">Bookmarks you add will appear here.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6 p-4">
            {groupedBookmarks.map((group) => (
              <section key={group.key} className="flex flex-col gap-3">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {group.label}
                </h3>
                <table className="w-full table-fixed text-left text-sm">
                  <thead>
                    <tr>
                      <th className="w-[140px] pb-1 text-left text-[10px] font-normal text-muted-foreground/60">
                        Created
                      </th>
                      <th className="w-16 pb-1 text-left text-[10px] font-normal text-muted-foreground/60">
                        Page
                      </th>
                      <th className="w-auto pb-1 text-left text-[10px] font-normal text-muted-foreground/60">
                        Chapter
                      </th>
                      <th className="w-8 pb-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {group.bookmarks.map((bookmark) => (
                      <tr
                        key={bookmark.id}
                        className={
                          bookmark.cfi
                            ? "cursor-pointer transition-colors hover:bg-accent/50"
                            : "text-muted-foreground/60"
                        }
                        onClick={() => {
                          if (bookmark.cfi) handleNavigateToBookmark(bookmark.cfi);
                        }}
                      >
                        <td className="w-[140px] whitespace-nowrap py-1.5 pr-5 text-xs tabular-nums text-muted-foreground">
                          {formatCreatedAt(bookmark.createdAt)}
                        </td>
                        <td className="w-16 whitespace-nowrap py-1.5 pr-4 text-xs tabular-nums text-muted-foreground">
                          {bookmark.displayPage ?? bookmark.pageNumber ?? "—"}
                        </td>
                        <td className="max-w-0 truncate py-1.5 text-xs text-muted-foreground">
                          {bookmark.label ?? "Unknown chapter"}
                        </td>
                        <td className="w-8 py-1.5 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                              render={<button type="button" />}
                              onClick={(e) => e.stopPropagation()}
                              aria-label="Bookmark actions"
                            >
                              <MoreHorizontal className="size-3.5" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="text-xs">
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteBookmark(bookmark.id);
                                }}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="size-3.5" />
                                Delete bookmark
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
        )}
      </ScrollArea>

      <div className="border-t p-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          disabled={entries.length === 0 || isClearing}
          onClick={handleClearBookmarks}
        >
          <Trash2 data-icon="inline-start" />
          {isClearing ? "Clearing…" : "Clear all bookmarks"}
        </Button>
      </div>
    </div>
  );
}
