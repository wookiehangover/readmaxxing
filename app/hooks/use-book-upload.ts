import { useCallback } from "react";
import type React from "react";
import type { BookMeta } from "~/lib/stores/book-store";
import { useAppStore } from "~/lib/themis/provider";
import { uploadBooksRequested } from "~/lib/themis/books/books-slice";

interface UseBookUploadOptions {
  onBookAdded: (book: BookMeta) => void;
}

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
