import { useCallback } from "react";
import type React from "react";
import type { BookMeta } from "~/lib/stores/book-store";
import { useAppStore } from "~/lib/themis/provider";
import { uploadBooksRequested } from "~/lib/themis/books/books-slice";

interface UseBookUploadOptions {
  /** UI side effect called after the saga saves and stores each book. */
  onBookAdded: (book: BookMeta) => void;
}

/**
 * Shared hook that dispatches file-input uploads to the books saga.
 * Supports both .epub and .pdf files.
 *
 * Returns a change-event handler suitable for `<input type="file" onChange={…} />`.
 * The handler resets the input value after processing so the same file can be re-selected.
 */
export function useBookUpload({ onBookAdded }: UseBookUploadOptions) {
  const store = useAppStore();
  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;
      const bookFiles = Array.from(files).filter(
        (f) => f.name.endsWith(".epub") || f.name.endsWith(".pdf"),
      );

      if (bookFiles.length > 0) store.dispatch(uploadBooksRequested(bookFiles, onBookAdded));
      e.target.value = "";
    },
    [onBookAdded, store],
  );

  return { handleFileInput };
}
