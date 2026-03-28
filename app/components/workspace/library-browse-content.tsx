import { useState, useCallback, useRef, useEffect } from "react";
import { NotebookPen, Ellipsis, Globe, Trash2 } from "lucide-react";
import { CoverImage, CoverPlaceholder, AddBookCard } from "~/components/book-grid";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import type { BookMeta } from "~/lib/book-store";
import { useBookUpload } from "~/lib/use-book-upload";
import { useBookDeletion } from "~/lib/use-book-deletion";
import { useWorkspace } from "~/lib/workspace-context";

export function LibraryBrowseContent() {
  const ws = useWorkspace();
  const [books, setBooks] = useState<BookMeta[]>(ws.booksRef.current);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const prev = ws.booksChangeListener.current;
    ws.booksChangeListener.current = () => setBooks([...ws.booksRef.current]);
    return () => {
      ws.booksChangeListener.current = prev;
    };
  }, [ws]);

  const handleOpenBook = useCallback(
    (book: BookMeta) => {
      ws.openBookRef.current?.(book);
    },
    [ws],
  );

  const handleOpenNotebook = useCallback(
    (book: BookMeta) => {
      ws.openNotebookRef.current?.(book);
    },
    [ws],
  );

  const handleBookAdded = useCallback(
    (book: BookMeta) => {
      ws.onBookAddedRef.current?.(book);
    },
    [ws],
  );

  const handleBookDeleted = useCallback(
    (bookId: string) => {
      ws.onBookDeletedRef.current?.(bookId);
    },
    [ws],
  );

  const { handleDeleteBook } = useBookDeletion({ onBookDeleted: handleBookDeleted });
  const { handleFileInput } = useBookUpload({ onBookAdded: handleBookAdded });

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".epub"
        multiple
        className="hidden"
        onChange={handleFileInput}
      />
      {books.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
          <div className="w-40">
            <AddBookCard onClick={() => fileInputRef.current?.click()} />
          </div>
          <button
            type="button"
            onClick={() => ws.openStandardEbooksRef.current?.()}
            className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <Globe className="size-4" />
            Browse Standard Ebooks
          </button>
        </div>
      ) : (
        <div className="h-full overflow-y-auto p-4 md:p-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {books.map((book) => (
              <div key={book.id} className="group relative">
                <button
                  type="button"
                  onClick={() => handleOpenBook(book)}
                  className="block w-full text-left"
                >
                  <div className="overflow-hidden rounded-lg shadow-sm transition-shadow group-hover:shadow-md">
                    {book.coverImage ? (
                      <CoverImage coverImage={book.coverImage} alt={book.title} />
                    ) : (
                      <CoverPlaceholder title={book.title} author={book.author} />
                    )}
                  </div>
                  <p className="mt-2 truncate text-sm font-medium">{book.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{book.author}</p>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="absolute top-1 right-1 flex size-7 items-center justify-center rounded-md bg-black/50 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/70 focus-visible:opacity-100 group-hover:opacity-100"
                    render={<button type="button" />}
                    onClick={(e) => e.preventDefault()}
                  >
                    <Ellipsis className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleOpenNotebook(book)}>
                      <NotebookPen className="size-4" />
                      Open notebook
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
                onClick={() => ws.openStandardEbooksRef.current?.()}
                className="flex aspect-[2/3] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-muted-foreground/25 text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:text-foreground"
              >
                <Globe className="size-6" />
                <span className="text-xs font-medium">Standard Ebooks</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
