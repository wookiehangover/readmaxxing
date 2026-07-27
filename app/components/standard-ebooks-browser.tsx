import { useState, useCallback, useEffect, useRef } from "react";
import { Effect } from "effect";
import { Globe, Loader2, Plus, Check } from "lucide-react";
import { StandardEbooksToolbar } from "~/components/standard-ebooks-toolbar";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { StandardEbooksService, type SEBook } from "~/lib/standard-ebooks";
import { BookService, type BookMeta } from "~/lib/stores/book-store";
import { parseEpubEffect } from "~/lib/epub/epub-service";
import { AppRuntime } from "~/lib/effect-runtime";
import { computeFileHash } from "~/lib/book-hash";
import { useEffectQuery } from "~/hooks/use-effect-query";

interface StandardEbooksBrowserProps {
  onBookAdded: (book: BookMeta) => void;
}

export function StandardEbooksBrowser({ onBookAdded }: StandardEbooksBrowserProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchPage, setSearchPage] = useState(1);
  const [books, setBooks] = useState<SEBook[]>([]);
  const [downloadingUrls, setDownloadingUrls] = useState<Set<string>>(new Set());
  const [addedUrls, setAddedUrls] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
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
  const {
    data: searchResult,
    error: loadError,
    isLoading,
  } = useEffectQuery(
    () =>
      StandardEbooksService.pipe(Effect.andThen((s) => s.searchBooks(debouncedQuery, searchPage))),
    [debouncedQuery, searchPage],
  );

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
    searchResult !== undefined &&
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

      const program = Effect.gen(function* () {
        const seSvc = yield* StandardEbooksService;
        const arrayBuffer = yield* seSvc.downloadEpub(seBook.urlPath);
        const fileHash = yield* Effect.promise(() => computeFileHash(arrayBuffer));

        const existing = yield* BookService.pipe(Effect.andThen((s) => s.findByFileHash(fileHash)));
        if (existing) return existing;

        const metadata = yield* parseEpubEffect(arrayBuffer);
        const book: BookMeta = {
          id: crypto.randomUUID(),
          title: metadata.title,
          author: metadata.author,
          coverImage: metadata.coverImage,
          format: "epub" as const,
          fileHash,
        };
        yield* BookService.pipe(Effect.andThen((s) => s.saveBook(book, arrayBuffer)));
        return book;
      });

      try {
        const book = await AppRuntime.runPromise(program);
        setAddedUrls((prev) => new Set(prev).add(seBook.urlPath));
        onBookAdded(book);
      } catch (err) {
        console.error("Failed to import book:", err);
        setError(`Failed to import "${seBook.title}". Please try again.`);
      } finally {
        setDownloadingUrls((prev) => {
          const next = new Set(prev);
          next.delete(seBook.urlPath);
          return next;
        });
      }
    },
    [downloadingUrls, addedUrls, onBookAdded],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0">
        <div className="flex flex-col gap-3 px-4 pt-4 md:px-6">
          <div>
          <h2 className="text-lg font-semibold">Browse Standard Ebooks</h2>
          <p className="text-sm text-muted-foreground">
            Search and import free, beautifully formatted public domain ebooks.
          </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {loadError && (
            <p className="text-sm text-destructive">
              Failed to load books. Check your network connection and try again.
            </p>
          )}
        </div>

        <StandardEbooksToolbar query={query} onQueryChange={setQuery} />
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4">
        {!isSearching && books.length > 0 && (
          <p className="mb-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Most Popular
          </p>
        )}

        {isInitialLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : books.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {isSearching ? "No books found for this search." : "No books available."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {books.map((book) => (
              <SEBookCard
                key={book.urlPath}
                book={book}
                isDownloading={downloadingUrls.has(book.urlPath)}
                isAdded={addedUrls.has(book.urlPath)}
                onDownload={handleDownload}
              />
            ))}
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

        <div className="mt-6 border-t pt-4 pb-2 text-center">
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
  return (
    <div className="group flex flex-col overflow-hidden rounded-lg border bg-card transition-shadow hover:shadow-md">
      <div className="aspect-[2/3] w-full overflow-hidden bg-muted">
        {book.coverUrl ? (
          <img
            src={book.coverUrl}
            alt={book.title}
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center p-3 text-center">
            <Globe className="mb-2 size-8 text-muted-foreground/50" />
            <p className="line-clamp-3 text-sm font-medium text-muted-foreground">{book.title}</p>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2">
        <a
          href={`https://standardebooks.org${book.urlPath}`}
          target="_blank"
          rel="noopener noreferrer"
          className="line-clamp-2 text-sm font-medium leading-tight hover:underline"
        >
          {book.title}
        </a>
        <p className="line-clamp-1 text-xs text-muted-foreground">{book.author}</p>
        <div className="mt-auto pt-1">
          <Button
            variant={isAdded ? "ghost" : "outline"}
            size="sm"
            className="w-full"
            disabled={isDownloading || isAdded}
            onClick={() => onDownload(book)}
          >
            {isDownloading ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Importing…
              </>
            ) : isAdded ? (
              <>
                <Check className="size-3.5" />
                Added
              </>
            ) : (
              <>
                <Plus className="size-3.5" />
                Add to Library
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border bg-card">
      <Skeleton className="aspect-[2/3] w-full rounded-none" />
      <div className="flex flex-col gap-1.5 p-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="mt-1 h-8 w-full" />
      </div>
    </div>
  );
}
