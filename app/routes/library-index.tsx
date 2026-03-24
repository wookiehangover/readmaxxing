import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router";
import { Effect } from "effect";
import { BookOpen, Ellipsis, FileText, Trash2 } from "lucide-react";
import type { Route } from "./+types/library-index";
import { BookService, type Book } from "~/lib/book-store";
import { AnnotationService } from "~/lib/annotations-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { DropZone } from "~/components/drop-zone";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "eBook Reader" },
    { name: "description", content: "A browser-based ebook reader" },
  ];
}

export async function clientLoader() {
  const books = await AppRuntime.runPromise(BookService.pipe(Effect.andThen((s) => s.getBooks())));
  return { books };
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return (
    <div className="flex h-screen items-center justify-center">
      <p className="text-muted-foreground">Loading library…</p>
    </div>
  );
}

function CoverImage({ coverImage, alt }: { coverImage: Blob; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(coverImage);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [coverImage]);

  if (!url) return null;

  return (
    <img
      src={url}
      alt={alt}
      className="aspect-[2/3] w-full rounded-lg object-cover"
    />
  );
}

function CoverPlaceholder({ title, author }: { title: string; author: string }) {
  return (
    <div className="flex aspect-[2/3] w-full flex-col items-center justify-center rounded-lg bg-muted p-3 text-center">
      <BookOpen className="mb-2 size-8 text-muted-foreground/50" />
      <p className="line-clamp-3 text-sm font-medium text-muted-foreground">
        {title}
      </p>
      {author && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/70">
          {author}
        </p>
      )}
    </div>
  );
}

export default function LibraryIndex({ loaderData }: Route.ComponentProps) {
  const [books, setBooks] = useState<Book[]>(loaderData.books);
  const navigate = useNavigate();

  const handleBookAdded = useCallback((book: Book) => {
    setBooks((prev) => [...prev, book]);
  }, []);

  const handleDeleteBook = useCallback(
    async (bookId: string) => {
      const confirmed = window.confirm("Are you sure you want to delete this book?");
      if (!confirmed) return;

      const program = Effect.gen(function* () {
        const bookSvc = yield* BookService;
        const annotationSvc = yield* AnnotationService;

        // Delete all highlights for this book
        const highlights = yield* annotationSvc.getHighlightsByBook(bookId);
        for (const hl of highlights) {
          yield* annotationSvc.deleteHighlight(hl.id);
        }

        // Delete the book itself
        yield* bookSvc.deleteBook(bookId);
      }).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            console.error("Failed to delete book:", error);
          }),
        ),
      );

      await AppRuntime.runPromise(program);
      setBooks((prev) => prev.filter((b) => b.id !== bookId));
    },
    [],
  );

  return (
    <DropZone onBookAdded={handleBookAdded}>
      {books.length === 0 ? (
        <div className="flex h-screen flex-col items-center justify-center text-center">
          <BookOpen className="mb-4 size-12 text-muted-foreground/50" />
          <p className="text-lg font-medium text-muted-foreground">
            Your library is empty
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Drop an .epub file anywhere to get started
          </p>
        </div>
      ) : (
        <div className="h-screen overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {books.map((book) => (
              <div key={book.id} className="group relative">
                <Link
                  to={`/books/${book.id}`}
                  className="block"
                >
                  <div className="overflow-hidden rounded-lg shadow-sm transition-shadow group-hover:shadow-md">
                    {book.coverImage ? (
                      <CoverImage coverImage={book.coverImage} alt={book.title} />
                    ) : (
                      <CoverPlaceholder title={book.title} author={book.author} />
                    )}
                  </div>
                  <p className="mt-2 truncate text-sm font-medium">{book.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {book.author}
                  </p>
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
                    <DropdownMenuItem
                      onClick={() => navigate(`/books/${book.id}/details`)}
                    >
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
          </div>
        </div>
      )}
    </DropZone>
  );
}
