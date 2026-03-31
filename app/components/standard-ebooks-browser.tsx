import { useState, useCallback, useEffect, useRef } from "react";
import { Effect } from "effect";
import { Globe, Loader2, Plus, Check, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { StandardEbooksService, type SEBook } from "~/lib/standard-ebooks";
import { BookService, type BookMeta } from "~/lib/book-store";
import { parseEpubEffect } from "~/lib/epub-service";
import { AppRuntime } from "~/lib/effect-runtime";
import { useEffectQuery } from "~/lib/use-effect-query";

interface StandardEbooksBrowserProps {
  onBookAdded: (book: BookMeta) => void;
}

export function StandardEbooksBrowser({ onBookAdded }: StandardEbooksBrowserProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchPage, setSearchPage] = useState(1);
  const [downloadingUrls, setDownloadingUrls] = useState<Set<string>>(new Set());
  const [addedUrls, setAddedUrls] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const isSearching = debouncedQuery.length > 0;
  const books = searchResult?.books ?? [];

  const handleDownload = useCallback(
    async (seBook: SEBook) => {
      if (downloadingUrls.has(seBook.urlPath) || addedUrls.has(seBook.urlPath)) return;

      setDownloadingUrls((prev) => new Set(prev).add(seBook.urlPath));
      setError(null);

      const program = Effect.gen(function* () {
        const seSvc = yield* StandardEbooksService;
        const arrayBuffer = yield* seSvc.downloadEpub(seBook.urlPath);
        const metadata = yield* parseEpubEffect(arrayBuffer);
        const book: BookMeta = {
          id: crypto.randomUUID(),
          title: metadata.title,
          author: metadata.author,
          coverImage: metadata.coverImage,
          format: "epub" as const,
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
      <div className="shrink-0 space-y-3 p-4 pb-0">
        <div>
          <h2 className="text-lg font-semibold">Browse Standard Ebooks</h2>
          <p className="text-sm text-muted-foreground">
            Search and import free, beautifully formatted public domain ebooks.
          </p>
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search Standard Ebooks…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {loadError && (
          <p className="text-sm text-destructive">
            Failed to load books. Check your network connection and try again.
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!isSearching && !isLoading && books.length > 0 && (
          <p className="mb-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Most Popular
          </p>
        )}

        {isLoading ? (
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

      {searchResult && searchResult.totalPages > 1 && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-t p-2">
          <Button
            variant="outline"
            size="sm"
            disabled={searchPage <= 1}
            onClick={() => setSearchPage(searchPage - 1)}
          >
            <ChevronLeft className="size-4" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {searchResult.currentPage} of {searchResult.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={searchPage >= searchResult.totalPages}
            onClick={() => setSearchPage(searchPage + 1)}
          >
            Next
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
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
