import { useCallback, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, BookOpen, Check, Loader2, Plus } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import type { SEBook } from "~/lib/standard-ebooks";
import { cn } from "~/lib/utils";

type SortColumn = "title" | "author";
type SortDirection = "asc" | "desc";
type SortState = { column: SortColumn; direction: SortDirection };

export interface StandardEbooksTableProps {
  books: SEBook[];
  isDownloading: (book: SEBook) => boolean;
  isAdded: (book: SEBook) => boolean;
  onDownload: (book: SEBook) => void | Promise<void>;
}

function SortHeader({
  label,
  column,
  sort,
  onSort,
  className,
}: {
  label: string;
  column: SortColumn;
  sort: SortState;
  onSort: (column: SortColumn) => void;
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

export function StandardEbooksTable({
  books,
  isDownloading,
  isAdded,
  onDownload,
}: StandardEbooksTableProps) {
  const [sort, setSort] = useState<SortState>({ column: "title", direction: "asc" });

  const handleSort = useCallback((column: SortColumn) => {
    setSort((previous) => ({
      column,
      direction: previous.column === column && previous.direction === "asc" ? "desc" : "asc",
    }));
  }, []);

  const sortedBooks = useMemo(
    () =>
      [...books].sort((a, b) => {
        const comparison = a[sort.column].localeCompare(b[sort.column], undefined, {
          sensitivity: "base",
        });
        return sort.direction === "asc" ? comparison : -comparison;
      }),
    [books, sort],
  );

  return (
    <div className="h-full overflow-y-auto">
      <Table className="table-fixed md:table-auto">
        <TableHeader className="sticky top-0 bg-background">
          <TableRow>
            <TableHead className="w-12" />
            <SortHeader label="Title" column="title" sort={sort} onSort={handleSort} />
            <SortHeader
              label="Author"
              column="author"
              sort={sort}
              onSort={handleSort}
              className="hidden md:table-cell"
            />
            <TableHead className="w-32 text-right md:w-36">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedBooks.map((book) => {
            const downloading = isDownloading(book);
            const added = isAdded(book);

            return (
              <TableRow key={book.urlPath}>
                <TableCell>
                  {book.coverUrl ? (
                    <img
                      src={book.coverUrl}
                      alt=""
                      loading="lazy"
                      className="h-12 w-8 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-8 items-center justify-center rounded bg-muted">
                      <BookOpen className="size-4 text-muted-foreground" />
                    </div>
                  )}
                </TableCell>
                <TableCell className="max-w-0 font-medium">
                  <a
                    href={`https://standardebooks.org${book.urlPath}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate hover:underline"
                  >
                    {book.title}
                  </a>
                  <span className="block truncate text-xs font-normal text-muted-foreground md:hidden">
                    {book.author}
                  </span>
                </TableCell>
                <TableCell className="hidden max-w-0 text-muted-foreground md:table-cell">
                  <span className="block truncate">{book.author}</span>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant={added ? "ghost" : "outline"}
                    size="sm"
                    disabled={downloading || added}
                    onClick={() => onDownload(book)}
                  >
                    {downloading ? (
                      <>
                        <Loader2 data-icon="inline-start" className="animate-spin" />
                        Importing…
                      </>
                    ) : added ? (
                      <>
                        <Check data-icon="inline-start" />
                        Added
                      </>
                    ) : (
                      <>
                        <Plus data-icon="inline-start" />
                        Add to Library
                      </>
                    )}
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
