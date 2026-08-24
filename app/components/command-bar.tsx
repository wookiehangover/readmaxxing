import { useCallback, useEffect, useState } from "react";
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
import { useOptionalWorkspace, type WorkspaceContextValue } from "~/lib/context/workspace-context";
import { getBookReadingPath } from "~/lib/reading-route";
import type { BookMeta } from "~/lib/stores/book-store";
import { useAppStore } from "~/lib/themis/provider";

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
        updatedAt={book.updatedAt}
      />
    );
  }

  return (
    <div className="flex h-12 w-8 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
      <BookOpen className="size-4" />
    </div>
  );
}

type CommandBarWorkspace = Pick<WorkspaceContextValue, "openBookRef"> | null;

export function openCommandBarBook(
  book: BookMeta,
  workspace: CommandBarWorkspace,
  navigate: (path: string) => void | Promise<void>,
): void {
  workspace?.openBookRef.current?.(book);
  void navigate(getBookReadingPath(book.id));
}

export function CommandBar() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const workspace = useOptionalWorkspace();
  const store = useAppStore();
  const books = store.booksSelectors.selectAllBooks.useValue();

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

  const handleSelectBook = useCallback(
    (book: BookMeta) => {
      openCommandBarBook(book, workspace, navigate);
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
