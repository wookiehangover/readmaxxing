import { useCallback } from "react";
import { Effect } from "effect";
import { BookService } from "~/lib/book-store";
import { AnnotationService } from "~/lib/annotations-store";
import { AppRuntime } from "~/lib/effect-runtime";

interface UseBookDeletionOptions {
  /** Called after the book and its highlights have been deleted from IndexedDB. */
  onBookDeleted: (bookId: string) => void;
}

/**
 * Shared hook that handles book deletion with confirmation and highlight cleanup.
 *
 * Returns a handler that prompts for confirmation, deletes all highlights for the book,
 * deletes the book itself, then calls `onBookDeleted`.
 */
export function useBookDeletion({ onBookDeleted }: UseBookDeletionOptions) {
  const handleDeleteBook = useCallback(
    async (bookId: string) => {
      const confirmed = window.confirm("Are you sure you want to delete this book?");
      if (!confirmed) return;

      const program = Effect.gen(function* () {
        const bookSvc = yield* BookService;
        const annotationSvc = yield* AnnotationService;

        // Delete all highlights for this book
        const highlights = yield* annotationSvc.getHighlightsByBook(bookId);
        yield* Effect.forEach(highlights, (hl) => annotationSvc.deleteHighlight(hl.id));

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
      onBookDeleted(bookId);
    },
    [onBookDeleted],
  );

  return { handleDeleteBook };
}
