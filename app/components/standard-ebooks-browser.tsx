import { useState, useCallback, useEffect, useRef } from "react";
import { Check, Ellipsis, ExternalLink, Globe, Loader2, Plus } from "lucide-react";
import { StandardEbooksToolbar } from "~/components/standard-ebooks-toolbar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Skeleton } from "~/components/ui/skeleton";
import { StandardEbooksTable } from "~/components/workspace/standard-ebooks-table";
import { LibraryHeaderControls } from "~/components/workspace/library-frame";
import { useSettings } from "~/lib/settings";
import { StandardEbooksService, type SEBook } from "~/lib/standard-ebooks";
import type { BookMeta } from "~/lib/stores/book-store";
import { uploadBooksRequested } from "~/lib/themis/books/books-slice";
import { useAppStore } from "~/lib/themis/provider";

interface StandardEbooksBrowserProps {
  onBookAdded: (book: BookMeta) => void;
}

export function StandardEbooksBrowser({ onBookAdded }: StandardEbooksBrowserProps) {
  const store = useAppStore();
  const [settings] = useSettings();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchPage, setSearchPage] = useState(1);
  const [books, setBooks] = useState<SEBook[]>([]);
  const [downloadingUrls, setDownloadingUrls] = useState<Set<string>>(new Set());
  const [addedUrls, setAddedUrls] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<Awaited<
    ReturnType<typeof StandardEbooksService.searchBooks>
  > | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim() === "") {
      setDebouncedQuery("");
      setSearchPage(1);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setSearchPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Search books or load popular books (empty query = popular)
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(false);
    StandardEbooksService.searchBooks(debouncedQuery, searchPage)
      .then((result) => {
        if (!cancelled) setSearchResult(result);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, searchPage]);

  useEffect(() => {
    setBooks([]);
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
  }, [debouncedQuery]);

  useEffect(() => {
    if (!searchResult) return;

    setBooks((previousBooks) => {
      const booksByUrl = new Map(
        (searchResult.currentPage === 1 ? [] : previousBooks).map((book) => [book.urlPath, book]),
      );
      for (const book of searchResult.books) booksByUrl.set(book.urlPath, book);
      return Array.from(booksByUrl.values());
    });
  }, [searchResult]);

  const isSearching = debouncedQuery.length > 0;
  const isInitialLoading = isLoading && books.length === 0;
  const isLoadingMore = isLoading && books.length > 0;
  const hasMore =
    searchResult !== null &&
    searchResult.currentPage === searchPage &&
    searchResult.currentPage < searchResult.totalPages;

  useEffect(() => {
    const loadMoreElement = loadMoreRef.current;
    if (!loadMoreElement || !hasMore || isLoading) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        setSearchPage((page) => page + 1);
      },
      { root: scrollContainerRef.current, rootMargin: "200px 0px" },
    );
    observer.observe(loadMoreElement);
    return () => observer.disconnect();
  }, [hasMore, isLoading]);

  const handleDownload = useCallback(
    async (seBook: SEBook) => {
      if (downloadingUrls.has(seBook.urlPath) || addedUrls.has(seBook.urlPath)) return;

      setDownloadingUrls((prev) => new Set(prev).add(seBook.urlPath));
      setError(null);

      try {
        const arrayBuffer = await StandardEbooksService.downloadEpub(seBook.urlPath);
        const finishDownload = () => {
          setDownloadingUrls((prev) => {
            const next = new Set(prev);
            next.delete(seBook.urlPath);
            return next;
          });
        };
        store.dispatch(
          uploadBooksRequested(
            [{ name: `${seBook.title}.epub`, arrayBuffer: async () => arrayBuffer }],
            (book) => {
              setAddedUrls((prev) => new Set(prev).add(seBook.urlPath));
              finishDownload();
              onBookAdded(book);
            },
            undefined,
            (uploadError) => {
              console.error("Failed to import book:", uploadError);
              setError(`Failed to import "${seBook.title}". Please try again.`);
              finishDownload();
            },
          ),
        );
      } catch (err) {
        console.error("Failed to import book:", err);
        setError(`Failed to import "${seBook.title}". Please try again.`);
        setDownloadingUrls((prev) => {
          const next = new Set(prev);
          next.delete(seBook.urlPath);
          return next;
        });
      }
    },
    [downloadingUrls, addedUrls, onBookAdded, store],
  );
  const isBookDownloading = useCallback(
    (book: SEBook) => downloadingUrls.has(book.urlPath),
    [downloadingUrls],
  );
  const isBookAdded = useCallback((book: SEBook) => addedUrls.has(book.urlPath), [addedUrls]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0">
        <div className="flex flex-col gap-3 px-4 md:px-6">
          <div className="pt-4 pb-2">
            <p className="text-xs text-muted-foreground">
              Ebooks from{" "}
              <a
                href="https://standardebooks.org"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                Standard Ebooks
              </a>
            </p>

            <p className="mt-1 text-xs text-muted-foreground/70">
              Standard Ebooks is a volunteer-driven project dedicated to producing free, beautiful
              digital literature.
            </p>
            <a
              href="https://standardebooks.org/donate"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-xs text-muted-foreground hover:text-foreground"
            >
              Support their mission →
            </a>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {loadError && (
            <p className="text-sm text-destructive">
              Failed to load books. Check your network connection and try again.
            </p>
          )}
        </div>

        <LibraryHeaderControls>
          <StandardEbooksToolbar query={query} onQueryChange={setQuery} />
        </LibraryHeaderControls>
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4">
        {isInitialLoading ? (
          settings.standardEbooksView === "grid" ? (
            <div className="flex flex-wrap gap-8 justify-center md:justify-start">
              {Array.from({ length: 12 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : (
            <StandardEbooksTableSkeleton />
          )
        ) : books.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {isSearching ? "No books found for this search." : "No books available."}
            </p>
          </div>
        ) : settings.standardEbooksView === "grid" ? (
          <div className="flex flex-wrap gap-8 justify-center md:justify-start">
            {books.map((book) => (
              <SEBookCard
                key={book.urlPath}
                book={book}
                isDownloading={isBookDownloading(book)}
                isAdded={isBookAdded(book)}
                onDownload={handleDownload}
              />
            ))}
          </div>
        ) : (
          <div className="w-full max-w-6xl [&>div]:h-auto [&>div]:overflow-visible">
            <StandardEbooksTable
              books={books}
              isDownloading={isBookDownloading}
              isAdded={isBookAdded}
              onDownload={handleDownload}
            />
          </div>
        )}

        {(hasMore || isLoadingMore) && (
          <div
            ref={loadMoreRef}
            className="flex h-12 items-center justify-center"
            aria-live="polite"
          >
            {isLoadingMore && (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                <span className="text-sm text-muted-foreground">Loading more books…</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SEBookCard({
  book,
  isDownloading,
  isAdded,
  onDownload,
}: {
  book: SEBook;
  isDownloading: boolean;
  isAdded: boolean;
  onDownload: (book: SEBook) => void;
}) {
  const isUnavailable = isDownloading || isAdded;

  return (
    <div className="group relative w-full max-w-40 md:max-w-52">
      <button
        type="button"
        onClick={() => onDownload(book)}
        disabled={isUnavailable}
        aria-label={
          isDownloading
            ? `Importing ${book.title}`
            : isAdded
              ? `${book.title} added to library`
              : `Add ${book.title} to library`
        }
        className="block w-full text-left disabled:cursor-wait"
      >
        <div className="relative overflow-hidden rounded-lg shadow-lg transition-shadow duration-500 book-cover-container group-hover:shadow-2xl">
          {book.coverUrl ? (
            <img
              src={book.coverUrl}
              alt={book.title}
              className="aspect-[2/3] w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex aspect-[2/3] w-full items-center justify-center bg-muted">
              <Globe className="size-8 text-muted-foreground/50" aria-hidden="true" />
            </div>
          )}
          {isDownloading && (
            <div className="absolute inset-0 flex items-center justify-center rounded bg-background/70">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
              <span className="sr-only">Importing…</span>
            </div>
          )}
        </div>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="mt-1 ml-auto flex size-7 items-center justify-center rounded-md text-foreground/70 opacity-20 backdrop-blur-sm transition-opacity hover:bg-muted/80 focus-visible:opacity-100 group-hover:opacity-100"
          render={<button type="button" aria-label={`Actions for ${book.title}`} />}
          onClick={(event) => event.preventDefault()}
        >
          <Ellipsis className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto">
          <DropdownMenuGroup>
            <DropdownMenuItem
              render={
                <a
                  href={`https://standardebooks.org${book.urlPath}`}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <ExternalLink className="size-4" />
              View on Standard Ebooks
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isUnavailable} onClick={() => onDownload(book)}>
              {isUnavailable ? <Check className="size-4" /> : <Plus className="size-4" />}
              {isUnavailable ? "Added" : "Add to library"}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="w-full max-w-40 md:max-w-52">
      <Skeleton className="aspect-[2/3] w-full rounded-lg shadow-lg" />
    </div>
  );
}

function StandardEbooksTableSkeleton() {
  return (
    <div className="flex w-full max-w-6xl flex-col overflow-hidden rounded-md border">
      <Skeleton className="h-10 w-full rounded-none" />
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="border-t p-2">
          <Skeleton className="h-12 w-full" />
        </div>
      ))}
    </div>
  );
}
