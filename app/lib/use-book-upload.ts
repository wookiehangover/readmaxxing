import { useCallback } from "react";
import type React from "react";
import { Effect } from "effect";
import { BookService, type BookMeta } from "~/lib/book-store";
import type { BookFormat } from "~/lib/book-store";
import { parseEpubEffect } from "~/lib/epub-service";
import { parsePdfEffect } from "~/lib/pdf-service";
import { AppRuntime } from "~/lib/effect-runtime";

interface UseBookUploadOptions {
  /** Called after each book is saved to IndexedDB. */
  onBookAdded: (book: BookMeta) => void;
}

/**
 * Shared hook that handles file-input upload → parse → IndexedDB save.
 * Supports both .epub and .pdf files.
 *
 * Returns a change-event handler suitable for `<input type="file" onChange={…} />`.
 * The handler resets the input value after processing so the same file can be re-selected.
 */
export function useBookUpload({ onBookAdded }: UseBookUploadOptions) {
  const handleFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;
      const bookFiles = Array.from(files).filter(
        (f) => f.name.endsWith(".epub") || f.name.endsWith(".pdf"),
      );

      const program = Effect.forEach(bookFiles, (file) =>
        Effect.gen(function* () {
          const arrayBuffer = yield* Effect.promise(() => file.arrayBuffer());
          const isPdf = file.name.toLowerCase().endsWith(".pdf");
          const format: BookFormat = isPdf ? "pdf" : "epub";

          const metadata = isPdf
            ? yield* parsePdfEffect(arrayBuffer, file.name)
            : yield* parseEpubEffect(arrayBuffer);

          const book: BookMeta = {
            id: crypto.randomUUID(),
            title: metadata.title,
            author: metadata.author,
            coverImage: metadata.coverImage,
            format,
          };
          yield* BookService.pipe(Effect.andThen((s) => s.saveBook(book, arrayBuffer)));
          onBookAdded(book);
        }),
      ).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            console.error("Failed to add book:", error);
          }),
        ),
      );

      await AppRuntime.runPromise(program);
      e.target.value = "";
    },
    [onBookAdded],
  );

  return { handleFileInput };
}
