import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router";
import {
  Bookmark,
  BookOpen,
  ChartLine,
  CloudDownload,
  MessageSquare,
  Plus,
  ArrowUpDown,
  Settings,
  PanelLeft,
  PanelLeftClose,
  Search,
  Notebook,
} from "lucide-react";
import { BookCover, FILTER_THRESHOLD } from "~/components/book-list";
import { filterBooks } from "~/lib/workspace-utils";
import { SyncStatus } from "~/components/sync-status";
import { LayoutModeSwitcher } from "~/components/workspace/layout-mode-switcher";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";
import { type BookMeta, bookNeedsDownload } from "~/lib/stores/book-store";
import type { WorkspaceSortBy, LayoutMode } from "~/lib/settings";
import type { ClusterBarEntry } from "~/hooks/use-focused-mode";
import { cn } from "~/lib/utils";
import { useWorkspace } from "~/lib/context/workspace-context";

/** Delay after sidebar CSS transition before dispatching resize (ms) */
const SIDEBAR_TRANSITION_MS = 270;

const SORT_OPTIONS: { value: WorkspaceSortBy; label: string }[] = [
  { value: "recent", label: "Recently Opened" },
  { value: "title", label: "Title (A\u2013Z)" },
  { value: "author", label: "Author (A\u2013Z)" },
];

function WorkspaceSidebarBookContent({ book, collapsed }: { book: BookMeta; collapsed: boolean }) {
  const needsDownload = bookNeedsDownload(book);
  return (
    <>
      <div className="relative shrink-0">
        {book.coverImage || book.remoteCoverUrl ? (
          <BookCover
            coverImage={book.coverImage}
            remoteCoverUrl={book.remoteCoverUrl}
            bookId={book.id}
            updatedAt={book.updatedAt}
          />
        ) : (
          <div className="flex h-12 w-8 items-center justify-center rounded bg-muted">
            <span className="text-xs text-muted-foreground">📖</span>
          </div>
        )}
        {needsDownload && (
          <div className="absolute inset-0 flex items-center justify-center rounded bg-black/30">
            <CloudDownload className="size-4 text-white" />
          </div>
        )}
      </div>
      {!collapsed && (
        <div className={cn("min-w-0 flex-1", { "opacity-60": needsDownload })}>
          <p className="truncate text-sm font-medium">{book.title}</p>
          <p className="truncate text-xs text-muted-foreground">{book.author}</p>
        </div>
      )}
    </>
  );
}

export interface WorkspaceSidebarProps {
  collapsed: boolean;
  sortBy: WorkspaceSortBy;
  layoutMode: LayoutMode;
  openBooks: BookMeta[];
  otherBooks: BookMeta[];
  /**
   * Snapshot getter for the current focused-mode clusters, in
   * `focusedOrderRef` order. Read whenever `layoutMode === "focused"`; the
   * sidebar re-renders on cluster changes via `subscribeClusterChanges`.
   */
  getClusterEntries: () => ClusterBarEntry[];
  /** Snapshot getter for the active focused-mode cluster's bookId. */
  getActiveClusterId: () => string | null;
  onUpdateSettings: (patch: {
    sidebarCollapsed?: boolean;
    workspaceSortBy?: WorkspaceSortBy;
    layoutMode?: LayoutMode;
  }) => void;
  onOpenBook: (book: BookMeta) => void;
  onOpenChat: (book: BookMeta) => void;
  onOpenNotebook: (book: BookMeta) => void;
  onOpenBookmarks: (book: BookMeta) => void;
  onOpenReadingHistory: (book: BookMeta) => void;
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function WorkspaceSidebar({
  collapsed,
  sortBy,
  layoutMode,
  openBooks,
  otherBooks,
  getClusterEntries,
  getActiveClusterId,
  onUpdateSettings,
  onOpenBook,
  onOpenChat,
  onOpenNotebook,
  onOpenBookmarks,
  onOpenReadingHistory,
  onFileInput,
}: WorkspaceSidebarProps) {
  const ws = useWorkspace();
  const [filterQuery, setFilterQuery] = useState("");
  // Bump on cluster add/remove/activate so the collapsed focused-mode rail
  // re-derives its entries from `getClusterEntries()`. Subscribed only in
  // focused mode to avoid unnecessary work in freeform.
  const [, setClusterVersion] = useState(0);
  useEffect(() => {
    if (layoutMode !== "focused") return;
    return ws.subscribeClusterChanges(() => setClusterVersion((v) => v + 1));
  }, [layoutMode, ws]);

  const totalBooks = openBooks.length + otherBooks.length;
  const showFilter = !collapsed && totalBooks > FILTER_THRESHOLD;
  const filteredOpenBooks = useMemo(
    () => (filterQuery ? filterBooks(openBooks, filterQuery) : openBooks),
    [openBooks, filterQuery],
  );
  const filteredOtherBooks = useMemo(
    () => (filterQuery ? filterBooks(otherBooks, filterQuery) : otherBooks),
    [otherBooks, filterQuery],
  );

  // In focused mode + collapsed sidebar, actions operate on the active
  // cluster's book. Resolve it from the lists the parent already passes; fall
  // back to a stub if the book hasn't loaded yet so buttons remain clickable.
  const isCollapsedFocused = collapsed && layoutMode === "focused";
  const activeClusterId = isCollapsedFocused ? getActiveClusterId() : null;
  const activeClusterBook = useMemo(() => {
    if (!isCollapsedFocused || !activeClusterId) return null;

    const byId = new Map<string, BookMeta>();
    for (const b of openBooks) byId.set(b.id, b);
    for (const b of otherBooks) byId.set(b.id, b);

    const existingBook = byId.get(activeClusterId);
    if (existingBook) return existingBook;

    const entry = getClusterEntries().find((cluster) => cluster.bookId === activeClusterId);
    if (!entry) return null;

    return {
      id: entry.bookId,
      title: entry.bookTitle,
      author: "",
    } as BookMeta;
  }, [isCollapsedFocused, activeClusterId, openBooks, otherBooks, getClusterEntries]);
  const railOpenBooks = useMemo(() => {
    if (!isCollapsedFocused) return filteredOpenBooks;
    const byId = new Map<string, BookMeta>();
    for (const b of openBooks) byId.set(b.id, b);
    for (const b of otherBooks) byId.set(b.id, b);
    return getClusterEntries().map(
      (entry) =>
        byId.get(entry.bookId) ??
        ({
          id: entry.bookId,
          title: entry.bookTitle,
          author: "",
        } as BookMeta),
    );
    // `getClusterEntries` reads from refs, so we additionally depend on the
    // cluster-version state above via the subscriber effect (which calls
    // setClusterVersion). Including it here would be a no-op since this
    // useMemo runs on every render anyway when version changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCollapsedFocused, openBooks, otherBooks, getClusterEntries, activeClusterId]);

  function handleOpenSearch(book: BookMeta) {
    queueMicrotask(() => {
      window.dispatchEvent(new CustomEvent("book-search:open", { detail: { bookId: book.id } }));
    });
  }

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r bg-card transition-[width] duration-200 ease-in-out",
        { "w-14": collapsed, "w-75": !collapsed },
      )}
    >
      <div className="flex items-center justify-between h-11 border-b px-2">
        {!collapsed && (
          <div className="relative">
            <ArrowUpDown className="pointer-events-none absolute top-1/2 left-1.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <select
              value={sortBy}
              onChange={(e) =>
                onUpdateSettings({
                  workspaceSortBy: e.target.value as WorkspaceSortBy,
                })
              }
              className="h-7 appearance-none rounded border-none bg-transparent py-0 pr-2 pl-6 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none"
              title="Sort books"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {collapsed ? (
          <button
            type="button"
            onClick={() => {
              onUpdateSettings({ sidebarCollapsed: false });
              setTimeout(() => {
                window.dispatchEvent(new Event("resize"));
              }, SIDEBAR_TRANSITION_MS);
            }}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground mx-auto"
            title="Expand sidebar"
          >
            <PanelLeft className="size-4" />
          </button>
        ) : (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => ws.fileInputRef.current?.click()}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Add books"
            >
              <Plus className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                onUpdateSettings({ sidebarCollapsed: true });
                setTimeout(() => {
                  window.dispatchEvent(new Event("resize"));
                }, SIDEBAR_TRANSITION_MS);
              }}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="size-4" />
            </button>
          </div>
        )}
        <input
          ref={ws.fileInputRef}
          type="file"
          accept=".epub,.pdf"
          multiple
          className="hidden"
          onChange={onFileInput}
        />
      </div>
      {showFilter && (
        <div className="px-2 pt-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filter books…"
              className="h-7 pl-7 text-xs"
            />
          </div>
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1 scroll-fog-container" hideScrollbar>
        {isCollapsedFocused ? (
          activeClusterBook && (
            <TooltipProvider delay={400}>
              <div className="flex flex-col items-center gap-1 p-1">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        onClick={() => handleOpenSearch(activeClusterBook)}
                        className="flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                      />
                    }
                  >
                    <Search className="size-4" />
                    <span className="sr-only">Open search</span>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    Search
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        onClick={() => onOpenNotebook(activeClusterBook)}
                        className="flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                      />
                    }
                  >
                    <Notebook className="size-4" />
                    <span className="sr-only">Open notebook</span>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    Notebook
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        onClick={() => onOpenChat(activeClusterBook)}
                        className="flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                      />
                    }
                  >
                    <MessageSquare className="size-4" />
                    <span className="sr-only">Open chat</span>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    Chat
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        onClick={() => onOpenBookmarks(activeClusterBook)}
                        className="flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                      />
                    }
                  >
                    <Bookmark className="size-4" />
                    <span className="sr-only">Open bookmarks</span>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    Bookmarks
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        onClick={() => onOpenReadingHistory(activeClusterBook)}
                        className="flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                      />
                    }
                  >
                    <ChartLine className="size-4" />
                    <span className="sr-only">Open reading history</span>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    History
                  </TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
          )
        ) : openBooks.length === 0 && otherBooks.length === 0 ? (
          !collapsed && (
            <div className="p-4 text-xs text-muted-foreground space-y-4">
              <p>No books yet.</p>
              <p>Drop epub or click + to add.</p>
            </div>
          )
        ) : (
          <TooltipProvider delay={400}>
            <ul className="flex flex-col gap-0.5 p-1 grayscale hover:grayscale-0 transition-all">
              {railOpenBooks.map((book) => {
                const isActive = isCollapsedFocused && book.id === activeClusterId;
                return (
                  <li key={book.id} className="group/book relative">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            onClick={() => onOpenBook(book)}
                            className={cn("flex w-full items-center rounded-md text-left", {
                              "justify-center p-1.5": collapsed,
                              "gap-3 px-3 py-2": !collapsed,
                              "bg-primary/10 ring-1 ring-primary/40 hover:bg-primary/15": isActive,
                              "bg-accent/50 hover:bg-accent": !isActive,
                            })}
                          />
                        }
                      >
                        <WorkspaceSidebarBookContent book={book} collapsed={collapsed} />
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={8} hidden={!collapsed}>
                        <div>
                          <p>{book.title}</p>
                          {book.author && <p className="text-background/70">{book.author}</p>}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                    {collapsed ? (
                      <div className="absolute right-0.5 bottom-0.5 flex gap-0.5 opacity-0 group-hover/book:opacity-100">
                        <button
                          type="button"
                          onClick={() => onOpenBookmarks(book)}
                          className="flex size-5 items-center justify-center rounded-full bg-card text-muted-foreground shadow-sm ring-1 ring-border/50 hover:bg-accent hover:text-foreground"
                          title="Open bookmarks"
                        >
                          <Bookmark className="size-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenReadingHistory(book)}
                          className="flex size-5 items-center justify-center rounded-full bg-card text-muted-foreground shadow-sm ring-1 ring-border/50 hover:bg-accent hover:text-foreground"
                          title="Open reading history"
                        >
                          <ChartLine className="size-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="absolute top-1/2 right-1 flex -translate-y-1/2 gap-0.5 opacity-0 group-hover/book:opacity-100">
                        <button
                          type="button"
                          onClick={() => onOpenBook(book)}
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                          title="Open book"
                        >
                          <BookOpen className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenNotebook(book)}
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                          title="Open notebook"
                        >
                          <Notebook className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenBookmarks(book)}
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                          title="Open bookmarks"
                        >
                          <Bookmark className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenReadingHistory(book)}
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                          title="Open reading history"
                        >
                          <ChartLine className="size-3.5" />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
              {!collapsed && filteredOpenBooks.length > 0 && filteredOtherBooks.length > 0 && (
                <li className="my-1 border-b border-border/50" />
              )}
              {!collapsed &&
                filteredOtherBooks.map((book) => (
                  <li key={book.id} className="group/book relative">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            onClick={() => onOpenBook(book)}
                            className={cn(
                              "flex w-full items-center rounded-md text-left hover:bg-accent",
                              { "gap-3 px-3 py-2": !collapsed },
                            )}
                          />
                        }
                      >
                        <WorkspaceSidebarBookContent book={book} collapsed={collapsed} />
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={8} hidden={!collapsed}>
                        <div>
                          <p>{book.title}</p>
                          {book.author && <p className="text-background/70">{book.author}</p>}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                    <div className="absolute top-1/2 right-1 flex -translate-y-1/2 gap-0.5 opacity-0 group-hover/book:opacity-100">
                      <button
                        type="button"
                        onClick={() => onOpenBook(book)}
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        title="Open book"
                      >
                        <BookOpen className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenNotebook(book)}
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        title="Open notebook"
                      >
                        <Notebook className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenBookmarks(book)}
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        title="Open bookmarks"
                      >
                        <Bookmark className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenReadingHistory(book)}
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        title="Open reading history"
                      >
                        <ChartLine className="size-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
          </TooltipProvider>
        )}
      </ScrollArea>
      <div
        className={cn("flex  @container items-center ", {
          "px-1 justify-between h-10": !collapsed,
          "flex-col py-1.5 gap-1": collapsed,
        })}
      >
        <Link
          to="/settings"
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground",
            { "mx-auto": collapsed },
          )}
          title="Settings"
        >
          <Settings className="size-4" />
          {!collapsed && <span>Settings</span>}
        </Link>

        <LayoutModeSwitcher
          layoutMode={layoutMode}
          collapsed={collapsed}
          onChange={(mode) => onUpdateSettings({ layoutMode: mode })}
        />

        <div className={cn({ "order-first": collapsed })}>
          <TooltipProvider delay={300}>
            <SyncStatus collapsed={collapsed} />
          </TooltipProvider>
        </div>
      </div>
    </aside>
  );
}
