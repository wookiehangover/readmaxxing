import { useState, useCallback } from "react";
import { Effect } from "effect";
import { Button } from "~/components/ui/button";
import { Globe, Loader2, Plus, Check } from "lucide-react";
import { BookService, type BookMeta } from "~/lib/book-store";
import { StandardEbooksService, type SEBook } from "~/lib/standard-ebooks";
import { parseEpubEffect } from "~/lib/epub-service";
import { AppRuntime } from "~/lib/effect-runtime";
import { useWorkspace } from "~/lib/workspace-context";

/** Inline SE book card for chat results — compact horizontal layout. */
export function ChatSEBookCard({
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
    <div className="flex w-36 shrink-0 flex-col overflow-hidden rounded-lg border bg-card transition-shadow hover:shadow-md">
      <div className="aspect-[2/3] w-full overflow-hidden bg-muted">
        {book.coverUrl ? (
          <img
            src={book.coverUrl}
            alt={book.title}
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center p-2 text-center">
            <Globe className="mb-1 size-6 text-muted-foreground/50" />
            <p className="line-clamp-3 text-xs font-medium text-muted-foreground">{book.title}</p>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-1.5">
        <a
          href={`https://standardebooks.org${book.urlPath}`}
          target="_blank"
          rel="noopener noreferrer"
          className="line-clamp-2 text-xs font-medium leading-tight hover:underline"
        >
          {book.title}
        </a>
        <p className="line-clamp-1 text-[11px] text-muted-foreground">{book.author}</p>
        <div className="mt-auto pt-1">
          <Button
            variant={isAdded ? "ghost" : "outline"}
            size="sm"
            className="h-7 w-full text-xs"
            disabled={isDownloading || isAdded}
            onClick={() => onDownload(book)}
          >
            {isDownloading ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                Importing…
              </>
            ) : isAdded ? (
              <>
                <Check className="size-3" />
                Added
              </>
            ) : (
              <>
                <Plus className="size-3" />
                Add to Library
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Renders SE search results as a horizontally scrollable row of cards in chat. */
export function SEBookCardsInChat({ books }: { books: SEBook[] }) {
  const { onBookAddedRef } = useWorkspace();
  const [downloadingUrls, setDownloadingUrls] = useState<Set<string>>(new Set());
  const [addedUrls, setAddedUrls] = useState<Set<string>>(new Set());

  const handleDownload = useCallback(
    async (seBook: SEBook) => {
      if (downloadingUrls.has(seBook.urlPath) || addedUrls.has(seBook.urlPath)) return;

      setDownloadingUrls((prev) => new Set(prev).add(seBook.urlPath));

      const program = Effect.gen(function* () {
        const seSvc = yield* StandardEbooksService;
        const arrayBuffer = yield* seSvc.downloadEpub(seBook.urlPath);
        const metadata = yield* parseEpubEffect(arrayBuffer);
        const book: BookMeta = {
          id: crypto.randomUUID(),
          title: metadata.title,
          author: metadata.author,
          coverImage: metadata.coverImage,
        };
        yield* BookService.pipe(Effect.andThen((s) => s.saveBook(book, arrayBuffer)));
        return book;
      });

      try {
        const book = await AppRuntime.runPromise(program);
        setAddedUrls((prev) => new Set(prev).add(seBook.urlPath));
        onBookAddedRef.current?.(book);
      } catch (err) {
        console.error("Failed to import book from chat:", err);
      } finally {
        setDownloadingUrls((prev) => {
          const next = new Set(prev);
          next.delete(seBook.urlPath);
          return next;
        });
      }
    },
    [downloadingUrls, addedUrls, onBookAddedRef],
  );

  if (books.length === 0) return null;

  return (
    <div className="my-2 -mx-1 overflow-x-auto">
      <div className="flex gap-2 px-1 pb-2">
        {books.map((book) => (
          <ChatSEBookCard
            key={book.urlPath}
            book={book}
            isDownloading={downloadingUrls.has(book.urlPath)}
            isAdded={addedUrls.has(book.urlPath)}
            onDownload={handleDownload}
          />
        ))}
      </div>
    </div>
  );
}
