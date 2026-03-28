import { useState, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router";
import { Effect } from "effect";
import { Ellipsis, FileText, Globe, Trash2 } from "lucide-react";
import { CoverImage, CoverPlaceholder, AddBookCard } from "~/components/book-grid";
import type { Route } from "./+types/library-index";
import { BookService, type BookMeta } from "~/lib/book-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { useBookUpload } from "~/lib/use-book-upload";
import { useBookDeletion } from "~/lib/use-book-deletion";
import { DropZone } from "~/components/drop-zone";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { StandardEbooksBrowser } from "~/components/standard-ebooks-browser";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Reader" }, { name: "description", content: "A browser-based ebook reader" }];
}

export async function clientLoader() {
  const books = await AppRuntime.runPromise(BookService.pipe(Effect.andThen((s) => s.getBooks())));
  return { books };
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return (
    <div className="flex h-dvh items-center justify-center">
      <p className="text-muted-foreground">Loading library…</p>
    </div>
  );
}

export default function LibraryIndex({ loaderData }: Route.ComponentProps) {
  const [books, setBooks] = useState<BookMeta[]>(loaderData.books);
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [seBrowserOpen, setSeBrowserOpen] = useState(false);

  const handleBookAdded = useCallback((book: BookMeta) => {
    setBooks((prev) => [...prev, book]);
  }, []);

  const handleBookDeleted = useCallback((bookId: string) => {
    setBooks((prev) => prev.filter((b) => b.id !== bookId));
  }, []);

  const { handleFileInput } = useBookUpload({ onBookAdded: handleBookAdded });
  const { handleDeleteBook } = useBookDeletion({ onBookDeleted: handleBookDeleted });

  return (
    <DropZone onBookAdded={handleBookAdded}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".epub"
        multiple
        className="hidden"
        onChange={handleFileInput}
      />
      {books.length === 0 ? (
        <div className="flex h-dvh flex-col items-center justify-center gap-4 p-6">
          <div className="w-40">
            <AddBookCard onClick={() => fileInputRef.current?.click()} />
          </div>
          <Button variant="outline" size="sm" onClick={() => setSeBrowserOpen(true)}>
            <Globe className="size-4" />
            Browse Standard Ebooks
          </Button>
        </div>
      ) : (
        <div className="h-dvh overflow-y-auto p-4 md:p-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {books.map((book) => (
              <div key={book.id} className="group relative">
                <Link to={`/books/${book.id}`} className="block">
                  <div className="overflow-hidden rounded-lg shadow-sm transition-shadow group-hover:shadow-md">
                    {book.coverImage ? (
                      <CoverImage coverImage={book.coverImage} alt={book.title} />
                    ) : (
                      <CoverPlaceholder title={book.title} author={book.author} />
                    )}
                  </div>
                  <p className="mt-2 truncate text-sm font-medium">{book.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{book.author}</p>
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="absolute top-1 right-1 flex size-7 items-center justify-center rounded-md bg-black/50 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/70 focus-visible:opacity-100 group-hover:opacity-100"
                    render={<button type="button" />}
                    onClick={(e) => e.preventDefault()}
                  >
                    <Ellipsis className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => navigate(`/books/${book.id}/details`)}>
                      <FileText className="size-4" />
                      Details
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => handleDeleteBook(book.id)}
                    >
                      <Trash2 className="size-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
            <div>
              <AddBookCard onClick={() => fileInputRef.current?.click()} />
            </div>
            <div>
              <button
                type="button"
                onClick={() => setSeBrowserOpen(true)}
                className="flex aspect-[2/3] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-muted-foreground/25 text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:text-foreground"
              >
                <Globe className="size-6" />
                <span className="text-xs font-medium">Standard Ebooks</span>
              </button>
            </div>
          </div>
        </div>
      )}
      <Dialog open={seBrowserOpen} onOpenChange={setSeBrowserOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
          <StandardEbooksBrowser onBookAdded={handleBookAdded} />
        </DialogContent>
      </Dialog>
    </DropZone>
  );
}
