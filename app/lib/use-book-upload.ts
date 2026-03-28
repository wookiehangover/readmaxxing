import { useCallback } from "react";
import type React from "react";
import { Effect } from "effect";
import { BookService, type BookMeta } from "~/lib/book-store";
import { parseEpubEffect } from "~/lib/epub-service";
import { AppRuntime } from "~/lib/effect-runtime";

interface UseBookUploadOptions {
  /** Called after each book is saved to IndexedDB. */
  onBookAdded: (book: BookMeta) => void;
}

/**
 * Shared hook that handles file-input upload → epub parse → IndexedDB save.
 *
 * Returns a change-event handler suitable for `<input type="file" onChange={…} />`.
 * The handler resets the input value after processing so the same file can be re-selected.
 */
export function useBookUpload({ onBookAdded }: UseBookUploadOptions) {
  const handleFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;
      const epubFiles = Array.from(files).filter((f) => f.name.endsWith(".epub"));

      const program = Effect.forEach(epubFiles, (file) =>
        Effect.gen(function* () {
          const arrayBuffer = yield* Effect.promise(() => file.arrayBuffer());
          const metadata = yield* parseEpubEffect(arrayBuffer);
          const book: BookMeta = {
            id: crypto.randomUUID(),
            title: metadata.title,
            author: metadata.author,
            coverImage: metadata.coverImage,
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
