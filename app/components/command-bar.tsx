import { useCallback, useEffect, useState } from "react";
import { Effect } from "effect";
import { BookOpen } from "lucide-react";
import { useNavigate } from "react-router";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import { BookCover } from "~/components/book-list";
import { useSyncListener } from "~/hooks/use-sync-listener";
import { AppRuntime } from "~/lib/effect-runtime";
import { useOptionalWorkspace } from "~/lib/context/workspace-context";
import { BookService, type BookMeta } from "~/lib/stores/book-store";

function isEditableElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.closest("[cmdk-root]")) return false;
  if (element.isContentEditable) return true;
  return !!element.closest("input, textarea, [contenteditable='true'], [contenteditable='']");
}

function CommandBarBookIcon({ book }: { book: BookMeta }) {
  if (book.coverImage || book.remoteCoverUrl) {
    return (
      <BookCover
        coverImage={book.coverImage}
        remoteCoverUrl={book.remoteCoverUrl}
        bookId={book.id}
      />
    );
  }

  return (
    <div className="flex h-12 w-8 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
      <BookOpen className="size-4" />
    </div>
  );
}

export function CommandBar() {
  const [open, setOpen] = useState(false);
  const [books, setBooks] = useState<BookMeta[]>([]);
  const [hasLoadedBooks, setHasLoadedBooks] = useState(false);
  const navigate = useNavigate();
  const workspace = useOptionalWorkspace();
  const syncVersion = useSyncListener(["book"]);

  const loadBooks = useCallback(() => {
    AppRuntime.runPromise(BookService.pipe(Effect.andThen((s) => s.getBooks())))
      .then((nextBooks) => {
        setBooks(nextBooks);
        setHasLoadedBooks(true);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      if (isEditableElement(document.activeElement)) return;

      event.preventDefault();
      setOpen((currentOpen) => !currentOpen);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!open || hasLoadedBooks) return;
    loadBooks();
  }, [hasLoadedBooks, loadBooks, open]);

  useEffect(() => {
    if (syncVersion === 0 || !hasLoadedBooks) return;
    loadBooks();
  }, [hasLoadedBooks, loadBooks, syncVersion]);

  const handleSelectBook = useCallback(
    (book: BookMeta) => {
      const openBook = workspace?.openBookRef.current;
      if (openBook) {
        openBook(book);
      } else {
        navigate(`/books/${book.id}/details`);
      }
      setOpen(false);
    },
    [navigate, workspace],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Open book"
      description="Search books by title or author."
    >
      <Command>
        <CommandInput placeholder="Search books…" />
        <CommandList>
          <CommandEmpty>No books yet. Drop an .epub to get started.</CommandEmpty>
          <CommandGroup heading="Books">
            {books.map((book) => (
              <CommandItem
                key={book.id}
                value={`${book.title} ${book.author ?? ""}`}
                onSelect={() => handleSelectBook(book)}
              >
                <CommandBarBookIcon book={book} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{book.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{book.author}</p>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
