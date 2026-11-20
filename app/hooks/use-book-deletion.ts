import { useCallback } from "react";
import { useAppStore } from "~/lib/themis/provider";
import { deleteBookRequested } from "~/lib/themis/books/books-slice";

interface UseBookDeletionOptions {
  onBookDeleted: (bookId: string) => void;
}

export function useBookDeletion({ onBookDeleted }: UseBookDeletionOptions) {
  const store = useAppStore();
  const handleDeleteBook = useCallback(
    (bookId: string) => {
      const confirmed = window.confirm("Are you sure you want to delete this book?");
      if (!confirmed) return;

      store.dispatch(deleteBookRequested(bookId, onBookDeleted));
    },
    [onBookDeleted, store],
  );

  return { handleDeleteBook };
}
