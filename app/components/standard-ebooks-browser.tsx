import { useState, useCallback, useEffect, useRef } from "react";
import { Effect } from "effect";
import { Globe, Loader2, Plus, Check, Search, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Skeleton } from "~/components/ui/skeleton";
import { StandardEbooksService, type SEBook, type SESearchResult } from "~/lib/standard-ebooks";
import { BookService, type Book } from "~/lib/book-store";
import { parseEpubEffect } from "~/lib/epub-service";
import { AppRuntime } from "~/lib/effect-runtime";
import { useEffectQuery } from "~/lib/use-effect-query";
import { cn } from "~/lib/utils";

interface StandardEbooksBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBookAdded: (book: Book) => void;
}

export function StandardEbooksBrowser({
  open,
  onOpenChange,
  onBookAdded,
}: StandardEbooksBrowserProps) {
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

  // Load new releases when dialog opens
  const {
    data: newReleases,
    error: newReleasesError,
    isLoading: newReleasesLoading,
  } = useEffectQuery(
    () =>
      open
        ? StandardEbooksService.pipe(Effect.andThen((s) => s.getNewReleases()))
        : Effect.succeed([] as SEBook[]),
    [open],
  );

  // Search books when debounced query changes
  const {
    data: searchResult,
    error: searchError,
    isLoading: searchLoading,
  } = useEffectQuery(
    () =>
      debouncedQuery
        ? StandardEbooksService.pipe(
            Effect.andThen((s) => s.searchBooks(debouncedQuery, searchPage)),
          )
        : Effect.succeed(null as SESearchResult | null),
    [debouncedQuery, searchPage],
  );

  const isSearching = debouncedQuery.length > 0;
  const books = isSearching ? (searchResult?.books ?? []) : (newReleases ?? []);
  const isLoading = isSearching ? searchLoading : newReleasesLoading;
  const loadError = isSearching ? searchError : newReleasesError;

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebouncedQuery("");
      setSearchPage(1);
      setError(null);
    }
  }, [open]);

  const handleDownload = useCallback(
    async (seBook: SEBook) => {
      if (downloadingUrls.has(seBook.urlPath) || addedUrls.has(seBook.urlPath)) return;

      setDownloadingUrls((prev) => new Set(prev).add(seBook.urlPath));
      setError(null);

      const program = Effect.gen(function* () {
        const seSvc = yield* StandardEbooksService;
        const arrayBuffer = yield* seSvc.downloadEpub(seBook.urlPath);
        const metadata = yield* parseEpubEffect(arrayBuffer);
        const book: Book = {
          id: crypto.randomUUID(),
          title: metadata.title,
          author: metadata.author,
          coverImage: metadata.coverImage,
          data: arrayBuffer,
        };
        yield* BookService.pipe(Effect.andThen((s) => s.saveBook(book)));
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Browse Standard Ebooks</DialogTitle>
          <DialogDescription>
            Search and import free, beautifully formatted public domain ebooks.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search Standard Ebooks…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {loadError && (
          <p className="text-sm text-destructive">
            Failed to load books. Check your network connection and try again.
          </p>
        )}

        <ScrollArea className="flex-1 -mx-6 px-6">
          {!isSearching && !isLoading && books.length > 0 && (
            <p className="mb-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              New Releases
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
                {isSearching ? "No books found for this search." : "No new releases available."}
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
        </ScrollArea>

        {isSearching && searchResult && searchResult.totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
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
      </DialogContent>
    </Dialog>
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
            <p className="line-clamp-3 text-sm font-medium text-muted-foreground">
              {book.title}
            </p>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2">
        <p className="line-clamp-2 text-sm font-medium leading-tight">{book.title}</p>
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
