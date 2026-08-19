import type { WorkspaceContextValue } from "~/lib/context/workspace-context";
import { bookNeedsDownload, type BookMeta } from "~/lib/stores/book-store";
import { booksHydrated, downloadBookForOpenRequested } from "~/lib/themis/books/books-slice";
import type { AppStore } from "~/lib/themis/store";

interface EnsureLocalThenOpenOptions {
  openBook: (book: BookMeta) => void | Promise<void>;
  store: BooksCache;
  signal?: AbortSignal;
}

type BooksCache = Pick<AppStore, "dispatch">;
type WorkspaceBookListRef = Pick<WorkspaceContextValue, "booksRef">;

export function refreshBooksCache(cache: BooksCache, books: BookMeta[]): void {
  cache.dispatch(booksHydrated(books));
}

/** @deprecated Use the Themis books cache. Kept as a compatibility mirror helper. */
export function refreshWorkspaceBooks(workspace: WorkspaceBookListRef, books: BookMeta[]): void {
  workspace.booksRef.current = books;
  queueMicrotask(() => {
    window.dispatchEvent(
      new CustomEvent("sync:entity-updated", {
        detail: { entity: "book" },
      }),
    );
  });
}

export async function ensureLocalThenOpen(
  book: BookMeta,
  { openBook, store, signal }: EnsureLocalThenOpenOptions,
): Promise<void> {
  if (signal?.aborted) return;

  if (!bookNeedsDownload(book)) {
    await openBook(book);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal?.removeEventListener("abort", handleAbort);
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const handleAbort = () => resolveOnce();

    signal?.addEventListener("abort", handleAbort, { once: true });
    store.dispatch(
      downloadBookForOpenRequested(
        book.id,
        async (downloadedBook) => {
          if (signal?.aborted || settled) {
            resolveOnce();
            return;
          }
          try {
            await openBook(downloadedBook);
            resolveOnce();
          } catch (error) {
            rejectOnce(error instanceof Error ? error : new Error(String(error)));
          }
        },
        (error) => {
          if (signal?.aborted) {
            resolveOnce();
            return;
          }
          rejectOnce(new Error(error));
        },
      ),
    );
  });
}
