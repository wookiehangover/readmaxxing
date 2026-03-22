import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, useParams } from "react-router";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import type { Book } from "~/lib/book-store";
import { useReaderNavigation, type TocEntry } from "~/lib/reader-context";
import { cn } from "~/lib/utils";

interface BookListProps {
  books: Book[];
  collapsed?: boolean;
}

function BookCover({ coverImage }: { coverImage: Blob }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(coverImage);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [coverImage]);

  if (!url) return null;

  return <img src={url} alt="" className="h-12 w-8 shrink-0 rounded object-cover" />;
}

function TocList({
  entries,
  depth = 0,
  onNavigate,
}: {
  entries: TocEntry[];
  depth?: number;
  onNavigate: (href: string) => void;
}) {
  return (
    <>
      {entries.map((entry) => (
        <li key={entry.href}>
          <button
            type="button"
            className={cn(
              "w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-accent",
              depth > 0 && "text-muted-foreground",
            )}
            style={{ paddingLeft: `${8 + depth * 12}px` }}
            onClick={() => onNavigate(entry.href)}
          >
            {entry.label}
          </button>
          {entry.subitems && entry.subitems.length > 0 && (
            <ul>
              <TocList entries={entry.subitems} depth={depth + 1} onNavigate={onNavigate} />
            </ul>
          )}
        </li>
      ))}
    </>
  );
}

function BookItemContent({
  book,
  collapsed,
}: {
  book: Book;
  collapsed: boolean;
}) {
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

function TocPopoverItem({
  book,
  collapsed,
  linkClassName,
  toc,
  navigateToHref,
}: {
  book: Book;
  collapsed: boolean;
  linkClassName: string;
  toc: TocEntry[];
  navigateToHref: (href: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const suppressHoverUntil = useRef(0);

  const handleOpenChange = useCallback(
    (nextOpen: boolean, details: { reason: string }) => {
      // After an explicit dismiss (outside click or escape), suppress hover
      // re-opens for a short window so the popover stays closed.
      if (!nextOpen && (details.reason === "outside-press" || details.reason === "escape-key")) {
        suppressHoverUntil.current = Date.now() + 400;
        setOpen(false);
        return;
      }

      if (nextOpen && details.reason === "trigger-hover") {
        if (Date.now() < suppressHoverUntil.current) {
          return; // suppress
        }
      }

      setOpen(nextOpen);
    },
    [],
  );

  const handleNavigate = useCallback(
    (href: string) => {
      navigateToHref(href);
      setOpen(false);
    },
    [navigateToHref],
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        openOnHover
        delay={200}
        closeDelay={300}
        render={<NavLink to={`/books/${book.id}`} className={linkClassName} />}
      >
        <BookItemContent book={book} collapsed={collapsed} />
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

export function BookList({ books, collapsed = false }: BookListProps) {
  const params = useParams();
  const activeBookId = params.id;
  const { toc, navigateToHref } = useReaderNavigation();

  if (books.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
        {!collapsed && (
          <>
            <p className="text-sm text-muted-foreground">No books yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Drop an .epub file to get started</p>
          </>
        )}
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className={cn("flex flex-col gap-1", collapsed ? "items-center p-1" : "p-2")}>
        {books.map((book) => {
          const isActive = book.id === activeBookId;
          const showTocPopover = isActive && toc.length > 0;

          const linkClassName = cn(
            "flex items-center rounded-lg transition-colors",
            "hover:bg-accent",
            isActive && "bg-accent",
            collapsed ? "justify-center p-1.5" : "gap-3 px-3 py-2 text-left",
          );

          if (showTocPopover) {
            return (
              <TocPopoverItem
                key={book.id}
                book={book}
                collapsed={collapsed}
                linkClassName={linkClassName}
                toc={toc}
                navigateToHref={navigateToHref}
              />
            );
          }
          return (
            <NavLink key={book.id} to={`/books/${book.id}`} className={linkClassName}>
              <BookItemContent book={book} collapsed={collapsed} />
            </NavLink>
          );
        })}
      </div>
    </ScrollArea>
  );
}
