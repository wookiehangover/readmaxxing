import { Effect } from "effect";
import type { WorkspaceContextValue } from "~/lib/context/workspace-context";
import { AppRuntime } from "~/lib/effect-runtime";
import { BookService, bookNeedsDownload, type BookMeta } from "~/lib/stores/book-store";

interface DownloadResult {
  book: BookMeta;
  books: BookMeta[];
}

interface EnsureLocalThenOpenOptions {
  openBook: (book: BookMeta) => void | Promise<void>;
  refreshBooks: (books: BookMeta[]) => void;
  downloadBook?: (book: BookMeta) => Promise<DownloadResult>;
  signal?: AbortSignal;
}

type WorkspaceBookListRefs = Pick<WorkspaceContextValue, "booksRef" | "booksChangeListener">;

async function downloadBookForOpen(book: BookMeta): Promise<DownloadResult> {
  const books = await AppRuntime.runPromise(
    BookService.pipe(
      Effect.andThen((service) =>
        service.getBookData(book.id).pipe(Effect.andThen(() => service.getBooks())),
      ),
    ),
  );
  const downloadedBook = books.find((candidate) => candidate.id === book.id);
  if (!downloadedBook?.hasLocalFile) {
    throw new Error(`Book ${book.id} did not become available locally`);
  }
  return { book: downloadedBook, books };
}

export function refreshWorkspaceBooks(workspace: WorkspaceBookListRefs, books: BookMeta[]): void {
  workspace.booksRef.current = books;
  workspace.booksChangeListener.current?.();
}

export async function ensureLocalThenOpen(
  book: BookMeta,
  {
    openBook,
    refreshBooks,
    downloadBook = downloadBookForOpen,
    signal,
  }: EnsureLocalThenOpenOptions,
): Promise<void> {
  if (signal?.aborted) return;

  if (!bookNeedsDownload(book)) {
    await openBook(book);
    return;
  }

  const downloaded = await downloadBook(book);
  refreshBooks(downloaded.books);
  if (signal?.aborted) return;
  await openBook(downloaded.book);
}
