import type { BookMeta } from "~/lib/stores/book-store";

export function getBookReadingPath(bookId: string): string {
  return `/books/${encodeURIComponent(bookId)}`;
}

export function getReadingBookId(pathname: string): string | null {
  const match = /^\/books\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

interface ActivateReadingRouteOptions {
  readonly bookId: string;
  readonly books: readonly BookMeta[];
  readonly activeBookId: string | null;
  readonly openBook: (book: BookMeta) => void;
  readonly navigate: (path: string, options?: { replace?: boolean }) => void | Promise<void>;
}

export function activateReadingRoute({
  bookId,
  books,
  activeBookId,
  openBook,
  navigate,
}: ActivateReadingRouteOptions): void {
  const book = books.find((candidate) => candidate.id === bookId);
  if (!book) {
    void navigate("/library", { replace: true });
    return;
  }
  if (activeBookId !== book.id) openBook(book);
}
