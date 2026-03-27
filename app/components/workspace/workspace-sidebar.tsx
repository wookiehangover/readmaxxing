import { useState, useMemo, useCallback, useRef } from "react";
import { Link } from "react-router";
import {
  BookOpen,
  NotebookPen,
  Plus,
  ArrowUpDown,
  Settings,
  PanelLeft,
  PanelLeftClose,
  Search,
} from "lucide-react";
import { BookCover, TocList, filterBooks, FILTER_THRESHOLD } from "~/components/book-list";
import { Input } from "~/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { ScrollArea } from "~/components/ui/scroll-area";
import type { Book } from "~/lib/book-store";
import type { TocEntry } from "~/lib/reader-context";
import type { WorkspaceSortBy } from "~/lib/settings";
import { cn } from "~/lib/utils";
import { useWorkspace } from "~/lib/workspace-context";

/** Delay after sidebar CSS transition before dispatching resize (ms) */
const SIDEBAR_TRANSITION_MS = 270;

const SORT_OPTIONS: { value: WorkspaceSortBy; label: string }[] = [
  { value: "recent", label: "Recently Opened" },
  { value: "title", label: "Title (A\u2013Z)" },
  { value: "author", label: "Author (A\u2013Z)" },
];

function WorkspaceSidebarBookContent({ book, collapsed }: { book: Book; collapsed: boolean }) {
  return (
    <>
      {book.coverImage ? (
        <BookCover coverImage={book.coverImage} />
      ) : (
        <div className="flex h-12 w-8 shrink-0 items-center justify-center rounded bg-muted">
          <span className="text-xs text-muted-foreground">📖</span>
        </div>
      )}
      {!collapsed && (
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{book.title}</p>
          <p className="truncate text-xs text-muted-foreground">{book.author}</p>
        </div>
      )}
    </>
  );
}

function WorkspaceTocPopoverItem({
  book,
  collapsed,
  toc,
  onOpenBook,
  isOpen,
}: {
  book: Book;
  collapsed: boolean;
  toc: TocEntry[];
  onOpenBook: (e: React.MouseEvent) => void;
  isOpen: boolean;
}) {
  const { findNavForBook } = useWorkspace();
  const [open, setOpen] = useState(false);
  const suppressHoverUntil = useRef(0);

  const handleOpenChange = useCallback((nextOpen: boolean, details: { reason: string }) => {
    if (!nextOpen && (details.reason === "outside-press" || details.reason === "escape-key")) {
      suppressHoverUntil.current = Date.now() + 400;
      setOpen(false);
      return;
    }
    if (nextOpen && details.reason === "trigger-hover") {
      if (Date.now() < suppressHoverUntil.current) {
        return;
      }
    }
    setOpen(nextOpen);
  }, []);

  const handleNavigate = useCallback(
    (href: string) => {
      findNavForBook(book.id)?.(href);
      setOpen(false);
    },
    [findNavForBook, book.id],
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        openOnHover
        delay={200}
        closeDelay={300}
        render={
          <button
            type="button"
            onClick={onOpenBook}
            className={`flex w-full items-center rounded-md text-left hover:bg-accent ${
              collapsed ? "justify-center p-1.5" : "gap-3 px-3 py-2"
            } ${isOpen ? "bg-accent/50" : ""}`}
            title={book.title}
          />
        }
      >
        <WorkspaceSidebarBookContent book={book} collapsed={collapsed} />
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        className="max-h-80 w-56 overflow-y-auto p-1.5"
      >
        <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Table of Contents</p>
        <ul>
          <TocList entries={toc} onNavigate={handleNavigate} />
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export interface WorkspaceSidebarProps {
  collapsed: boolean;
  sortBy: WorkspaceSortBy;
  tocVersion: number;
  openBooks: Book[];
  otherBooks: Book[];
  onUpdateSettings: (patch: { sidebarCollapsed?: boolean; workspaceSortBy?: WorkspaceSortBy }) => void;
  onOpenBook: (book: Book, forceNew?: boolean) => void;
  onOpenNotebook: (book: Book) => void;
  onOpenNewTab: () => void;
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function WorkspaceSidebar({
  collapsed,
  sortBy,
  tocVersion,
  openBooks,
  otherBooks,
  onUpdateSettings,
  onOpenBook,
  onOpenNotebook,
  onOpenNewTab,
  onFileInput,
}: WorkspaceSidebarProps) {
  const ws = useWorkspace();
  const [filterQuery, setFilterQuery] = useState("");

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

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r bg-card transition-[width] duration-200 ease-in-out",
        { "w-14": collapsed, "w-75": !collapsed },
      )}
    >
      <div className="flex items-center justify-between border-b h-9 px-2">
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
          accept=".epub"
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
      <ScrollArea className="min-h-0 flex-1" hideScrollbar>
        {openBooks.length === 0 && otherBooks.length === 0 ? (
          !collapsed && (
            <p className="p-4 text-sm text-muted-foreground">
              No books yet. Drop an epub or click + to add.
            </p>
          )
        ) : (
          <ul className="flex flex-col gap-0.5 p-1 grayscale hover:grayscale-0 transition-all">
            {/* tocVersion is read here to trigger re-render when TOC data changes */}
            {void tocVersion}
            {filteredOpenBooks.map((book) => {
              const bookToc = ws.findTocForBook(book.id);
              const showTocPopover = bookToc && bookToc.length > 0;

              return (
                <li key={book.id} className="group/book relative">
                  {showTocPopover ? (
                    <WorkspaceTocPopoverItem
                      book={book}
                      collapsed={collapsed}
                      toc={bookToc}
                      onOpenBook={(e) => onOpenBook(book, e.metaKey || e.ctrlKey)}
                      isOpen={true}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => onOpenBook(book, e.metaKey || e.ctrlKey)}
                      className={cn(
                        "flex w-full items-center rounded-md text-left hover:bg-accent bg-accent/50",
                        {
                          "justify-center p-1.5": collapsed,
                          "gap-3 px-3 py-2": !collapsed,
                        },
                      )}
                      title={book.title}
                    >
                      <WorkspaceSidebarBookContent book={book} collapsed={collapsed} />
                    </button>
                  )}
                  {!collapsed && (
                    <div className="absolute top-1/2 right-1 flex -translate-y-1/2 gap-0.5 opacity-0 group-hover/book:opacity-100">
                      <button
                        type="button"
                        onClick={(e) => onOpenBook(book, e.metaKey || e.ctrlKey)}
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
                        <NotebookPen className="size-3.5" />
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
              filteredOtherBooks.map((book) => {
                const bookToc = ws.findTocForBook(book.id);
                const showTocPopover = bookToc && bookToc.length > 0;

                return (
                  <li key={book.id} className="group/book relative">
                    {showTocPopover ? (
                      <WorkspaceTocPopoverItem
                        book={book}
                        collapsed={collapsed}
                        toc={bookToc}
                        onOpenBook={(e) => onOpenBook(book, e.metaKey || e.ctrlKey)}
                        isOpen={false}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => onOpenBook(book, e.metaKey || e.ctrlKey)}
                        className={cn(
                          "flex w-full items-center rounded-md text-left hover:bg-accent",
                          { "gap-3 px-3 py-2": !collapsed },
                        )}
                        title={book.title}
                      >
                        <WorkspaceSidebarBookContent book={book} collapsed={collapsed} />
                      </button>
                    )}
                    <div className="absolute top-1/2 right-1 flex -translate-y-1/2 gap-0.5 opacity-0 group-hover/book:opacity-100">
                      <button
                        type="button"
                        onClick={(e) => onOpenBook(book, e.metaKey || e.ctrlKey)}
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
                        <NotebookPen className="size-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
          </ul>
        )}
      </ScrollArea>
      <div
        className={cn("border-t h-10 flex items-center @container", {
          "justify-between px-1": !collapsed,
          "justify-center": collapsed,
        })}
      >
        <Link
          to="/settings"
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
            { "mx-auto": collapsed },
          )}
          title="Settings"
        >
          <Settings className="size-4" />
          {!collapsed && <span>Settings</span>}
        </Link>
        {!collapsed && (
          <button
            type="button"
            onClick={onOpenNewTab}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Open library panel"
          >
            <Plus className="size-4" />
            <span>New tab</span>
          </button>
        )}
      </div>
    </aside>
  );
}
