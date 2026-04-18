import { useCallback, useMemo, useState } from "react";
import { Effect } from "effect";
import {
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  CloudDownload,
  Ellipsis,
  MessageSquare,
  NotebookPen,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { BookCover } from "~/components/book-list";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { type BookMeta, bookNeedsDownload } from "~/lib/stores/book-store";
import { WorkspaceService } from "~/lib/stores/workspace-store";
import { useEffectQuery } from "~/hooks/use-effect-query";
import { sortBooksForTable, type SortDirection, type TableSortColumn } from "~/lib/workspace-utils";
import { cn } from "~/lib/utils";

interface LibraryTableProps {
  books: BookMeta[];
  onOpenBook: (book: BookMeta) => void;
  onOpenNotebook: (book: BookMeta) => void;
  onOpenChat: (book: BookMeta) => void;
  onDeleteBook: (bookId: string) => void;
  onReloadBook: (bookId: string) => void;
  syncActive: boolean;
}

type SortState = { column: TableSortColumn; direction: SortDirection };

function formatDate(ts: number | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function SortHeader({
  label,
  column,
  sort,
  onSort,
  className,
}: {
  label: string;
  column: TableSortColumn;
  sort: SortState;
  onSort: (column: TableSortColumn) => void;
  className?: string;
}) {
  const active = sort.column === column;
  const Icon = active ? (sort.direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center gap-1 text-left font-medium hover:text-foreground"
        aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
      >
        {label}
        <Icon className={cn("size-3", { "opacity-40": !active })} />
      </button>
    </TableHead>
  );
}

export function LibraryTable({
  books,
  onOpenBook,
  onOpenNotebook,
  onOpenChat,
  onDeleteBook,
  onReloadBook,
  syncActive,
}: LibraryTableProps) {
  const { data: lastOpenedMap } = useEffectQuery(
    () => WorkspaceService.pipe(Effect.andThen((s) => s.getLastOpenedMap())),
    [],
  );

  const [sort, setSort] = useState<SortState>({ column: "lastOpened", direction: "desc" });

  const handleSort = useCallback((column: TableSortColumn) => {
    setSort((prev) => {
      if (prev.column === column) {
        return { column, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { column, direction: column === "lastOpened" ? "desc" : "asc" };
    });
  }, []);

  const sortedBooks = useMemo(
    () => sortBooksForTable(books, sort.column, sort.direction, lastOpenedMap),
    [books, sort, lastOpenedMap],
  );

  return (
    <div className="h-full overflow-y-auto">
      <Table>
        <TableHeader className="sticky top-0 bg-background">
          <TableRow>
            <TableHead className="w-12" />
            <SortHeader label="Title" column="title" sort={sort} onSort={handleSort} />
            <SortHeader label="Author" column="author" sort={sort} onSort={handleSort} />
            <SortHeader
              label="Format"
              column="format"
              sort={sort}
              onSort={handleSort}
              className="w-20"
            />
            <SortHeader
              label="Last opened"
              column="lastOpened"
              sort={sort}
              onSort={handleSort}
              className="w-32"
            />
            <SortHeader
              label="Updated"
              column="updated"
              sort={sort}
              onSort={handleSort}
              className="w-32"
            />
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedBooks.map((book) => {
            const needsDownload = bookNeedsDownload(book);
            const lastOpened = lastOpenedMap?.get(book.id);
            return (
              <TableRow
                key={book.id}
                className={cn("cursor-pointer", { "opacity-70": needsDownload })}
                onClick={() => onOpenBook(book)}
              >
                <TableCell>
                  <div className="relative">
                    {book.coverImage || book.remoteCoverUrl ? (
                      <BookCover
                        coverImage={book.coverImage}
                        remoteCoverUrl={book.remoteCoverUrl}
                        bookId={book.id}
                      />
                    ) : (
                      <div className="flex h-12 w-8 items-center justify-center rounded bg-muted">
                        <span className="text-xs text-muted-foreground">📖</span>
                      </div>
                    )}
                    {needsDownload && (
                      <div className="absolute inset-0 flex items-center justify-center rounded bg-black/30">
                        <CloudDownload className="size-3 text-white" />
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell className="max-w-0 font-medium">
                  <span className="block truncate">{book.title}</span>
                </TableCell>
                <TableCell className="max-w-0 text-muted-foreground">
                  <span className="block truncate">{book.author}</span>
                </TableCell>
                <TableCell className="uppercase text-muted-foreground">
                  {book.format ?? "epub"}
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDate(lastOpened)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(book.updatedAt)}
                </TableCell>
                <TableCell
                  className="text-right"
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="inline-flex size-7 items-center justify-center rounded-md hover:bg-accent"
                      render={<button type="button" />}
                      aria-label="Book actions"
                    >
                      <Ellipsis className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-auto">
                      <DropdownMenuItem onClick={() => onOpenNotebook(book)}>
                        <NotebookPen className="size-4" />
                        Open notebook
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onOpenChat(book)}>
                        <MessageSquare className="size-4" />
                        Open chat
                      </DropdownMenuItem>
                      {syncActive && (
                        <DropdownMenuItem onClick={() => onReloadBook(book.id)}>
                          <RefreshCw className="size-4" />
                          Sync
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem variant="destructive" onClick={() => onDeleteBook(book.id)}>
                        <Trash2 className="size-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
