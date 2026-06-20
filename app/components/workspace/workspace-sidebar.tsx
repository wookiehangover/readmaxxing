import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router";
import {
  Bookmark,
  ChartLine,
  ChevronDown,
  MessageSquare,
  Plus,
  Settings,
  PanelLeft,
  PanelLeftClose,
  Search,
  Notebook,
  Library,
} from "lucide-react";
import { LibrarySortControl } from "~/components/library-sort-control";
import { SyncStatus } from "~/components/sync-status";
import { LayoutModeSwitcher } from "~/components/workspace/layout-mode-switcher";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";
import type { BookMeta } from "~/lib/stores/book-store";
import type { WorkspaceSortBy, LayoutMode } from "~/lib/settings";
import type { ClusterBarEntry } from "~/hooks/use-focused-mode";
import { cn } from "~/lib/utils";
import { useWorkspace } from "~/lib/context/workspace-context";

/** Delay after sidebar CSS transition before dispatching resize (ms) */
const SIDEBAR_TRANSITION_MS = 270;

function WorkspaceSidebarActionButton({
  collapsed,
  label,
  srLabel,
  icon: Icon,
  active,
  onClick,
}: {
  collapsed: boolean;
  label: string;
  srLabel: string;
  icon: typeof Search;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onClick}
            className={cn(
              "flex rounded-md",
              collapsed
                ? "size-10 items-center justify-center"
                : "h-10 w-full items-center gap-3 px-3 text-sm",
              active === undefined
                ? "text-muted-foreground hover:bg-accent hover:text-foreground"
                : active
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          />
        }
      >
        <Icon className="size-4" />
        {collapsed ? <span className="sr-only">{srLabel}</span> : <span>{label}</span>}
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} hidden={!collapsed}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export interface WorkspaceSidebarProps {
  collapsed: boolean;
  sortBy: WorkspaceSortBy;
  layoutMode: LayoutMode;
  books: BookMeta[];
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
  onOpenLibrary: () => void;
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
  books,
  openBooks,
  otherBooks,
  getClusterEntries,
  getActiveClusterId,
  onUpdateSettings,
  onOpenLibrary,
  onOpenBook,
  onOpenChat,
  onOpenNotebook,
  onOpenBookmarks,
  onOpenReadingHistory,
  onFileInput,
}: WorkspaceSidebarProps) {
  const ws = useWorkspace();
  const [libraryExpanded, setLibraryExpanded] = useState(true);
  // Bump on cluster add/remove/activate so the collapsed focused-mode rail
  // re-derives its entries from `getClusterEntries()`. Subscribed only in
  // focused mode to avoid unnecessary work in freeform.
  const [clusterVersion, setClusterVersion] = useState(0);
  useEffect(() => {
    if (layoutMode !== "focused") return;
    return ws.subscribeClusterChanges(() => setClusterVersion((v) => v + 1));
  }, [layoutMode, ws]);

  const [, setPanelVersion] = useState(0);
  useEffect(() => {
    const api = ws.dockviewApi.current;
    if (!api) return;
    const bump = () => setPanelVersion((v) => v + 1);
    const d1 = api.onDidAddPanel(bump);
    const d2 = api.onDidRemovePanel(bump);
    return () => {
      d1.dispose();
      d2.dispose();
    };
  }, [ws.dockviewApi, clusterVersion]);

  // In focused mode, actions operate on the active
  // cluster's book. Resolve it from the lists the parent already passes; fall
  // back to a stub if the book hasn't loaded yet so buttons remain clickable.
  const isFocused = layoutMode === "focused";
  const activeClusterId = isFocused ? getActiveClusterId() : null;
  const activeClusterBook = useMemo(() => {
    if (!isFocused || !activeClusterId) return null;

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
  }, [isFocused, activeClusterId, openBooks, otherBooks, getClusterEntries]);

  function handleOpenSearch(book: BookMeta) {
    queueMicrotask(() => {
      window.dispatchEvent(new CustomEvent("book-search:open", { detail: { bookId: book.id } }));
    });
  }

  const showLibraryBooks = !collapsed && libraryExpanded && books.length > 0;

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r bg-card transition-[width] duration-200 ease-in-out",
        { "w-14": collapsed, "w-75": !collapsed },
      )}
    >
      <div
        className={cn("flex h-11 items-center border-b px-2", {
          "justify-center": collapsed,
          "justify-end": !collapsed,
        })}
      >
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
      <ScrollArea className="min-h-0 flex-1 scroll-fog-container" hideScrollbar>
        <TooltipProvider delay={400}>
          <div
            className={cn("flex flex-col gap-1 p-1", {
              "items-center": collapsed,
            })}
          >
            {collapsed ? (
              <WorkspaceSidebarActionButton
                collapsed={collapsed}
                label="Library"
                srLabel="Open library"
                icon={Library}
                onClick={onOpenLibrary}
              />
            ) : (
              <div className="w-full">
                <div className="flex h-10 items-center gap-1 rounded-md text-muted-foreground">
                  <button
                    type="button"
                    onClick={onOpenLibrary}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-muted hover:text-foreground"
                  >
                    <Library className="size-4 shrink-0" />
                    <span className="truncate">Library</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setLibraryExpanded((prev) => !prev)}
                    className="flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-muted hover:text-foreground"
                    aria-label={
                      libraryExpanded ? "Collapse library books" : "Expand library books"
                    }
                    aria-expanded={libraryExpanded}
                  >
                    <ChevronDown
                      className={cn("size-4 transition-transform", {
                        "-rotate-90": !libraryExpanded,
                      })}
                    />
                  </button>
                </div>
                {showLibraryBooks && (
                  <div className="mt-1 space-y-1 pl-7 pr-1 pb-2">
                    <LibrarySortControl
                      sortBy={sortBy}
                      onSortByChange={(workspaceSortBy) => onUpdateSettings({ workspaceSortBy })}
                    />
                    <div className="space-y-0.5">
                      {books.map((book) => (
                        <button
                          key={book.id}
                          type="button"
                          onClick={() => onOpenBook(book)}
                          className="flex w-full min-w-0 flex-col rounded-md px-2 py-1.5 text-left hover:bg-muted"
                        >
                          <span className="truncate text-xs font-medium text-foreground">
                            {book.title}
                          </span>
                          {book.author && (
                            <span className="truncate text-[11px] text-muted-foreground">
                              {book.author}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          {activeClusterBook &&
            (() => {
              const activeBookId = activeClusterBook.id;
              const api = ws.dockviewApi.current;
              const hasNotebook =
                api?.panels.some((p) => p.id === `notebook-${activeBookId}`) ?? false;
              const hasChat = api?.panels.some((p) => p.id === `chat-${activeBookId}`) ?? false;
              const hasBookmarks =
                api?.panels.some((p) => p.id === `bookmarks-${activeBookId}`) ?? false;
              const hasHistory =
                api?.panels.some((p) => p.id === `history-${activeBookId}`) ?? false;
              return (
                <div
                  className={cn("flex flex-col gap-1 p-1", {
                    "items-center": collapsed,
                  })}
                >
                  <WorkspaceSidebarActionButton
                    collapsed={collapsed}
                    label="Search"
                    srLabel="Open search"
                    icon={Search}
                    onClick={() => handleOpenSearch(activeClusterBook)}
                  />
                  <WorkspaceSidebarActionButton
                    collapsed={collapsed}
                    label="Notebook"
                    srLabel="Open notebook"
                    icon={Notebook}
                    active={hasNotebook}
                    onClick={() => onOpenNotebook(activeClusterBook)}
                  />
                  <WorkspaceSidebarActionButton
                    collapsed={collapsed}
                    label="Chat"
                    srLabel="Open chat"
                    icon={MessageSquare}
                    active={hasChat}
                    onClick={() => onOpenChat(activeClusterBook)}
                  />
                  <WorkspaceSidebarActionButton
                    collapsed={collapsed}
                    label="Bookmarks"
                    srLabel="Open bookmarks"
                    icon={Bookmark}
                    active={hasBookmarks}
                    onClick={() => onOpenBookmarks(activeClusterBook)}
                  />
                  <WorkspaceSidebarActionButton
                    collapsed={collapsed}
                    label="History"
                    srLabel="Open reading history"
                    icon={ChartLine}
                    active={hasHistory}
                    onClick={() => onOpenReadingHistory(activeClusterBook)}
                  />
                </div>
              );
            })()}
        </TooltipProvider>
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
