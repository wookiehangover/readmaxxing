import { useCallback } from "react";
import { useWorkspace } from "~/lib/context/workspace-context";

/**
 * Navigate the chat's book to a quoted passage, falling back to the chapter
 * (EPUB TOC entry or PDF page) when the quote cannot be found.
 */
export function useBookRefNavigation({
  bookId,
  bookFormat,
  bookDataRef,
}: {
  bookId: string;
  bookFormat?: string;
  bookDataRef: React.RefObject<ArrayBuffer | null>;
}) {
  const { navigateInCluster, findTocForBook, applyTempHighlightForBook } = useWorkspace();

  const navigateToChapter = useCallback(
    async (chapterIndex: number | undefined) => {
      if (chapterIndex == null || Number.isNaN(chapterIndex)) return false;
      if (bookFormat === "pdf") {
        await navigateInCluster(bookId, `page:${chapterIndex + 1}`);
        return true;
      }
      const entry = findTocForBook(bookId)?.[chapterIndex];
      if (!entry) return false;
      await navigateInCluster(bookId, entry.href);
      return true;
    },
    [bookId, bookFormat, navigateInCluster, findTocForBook],
  );

  const navigateToQuote = useCallback(
    async (query: string, chapterIndex?: number) => {
      const data = bookDataRef.current;
      if (!data || !query) {
        await navigateToChapter(chapterIndex);
        return;
      }
      try {
        if (bookFormat === "pdf") {
          const pdfjs = await import("pdfjs-dist");
          const { searchPdf } = await import("~/lib/pdf/pdf-search");
          const workerUrl = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url);
          pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.href;
          const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data).slice() });
          const doc = await loadingTask.promise;
          try {
            const results = await searchPdf(doc, query);
            if (results.length > 0) {
              await navigateInCluster(bookId, `page:${results[0].page}`);
              return;
            }
          } finally {
            await loadingTask.destroy().catch(() => {});
          }
        } else {
          const { fuzzySearchEpubForCfi } = await import("~/lib/epub/epub-search");
          const results = await fuzzySearchEpubForCfi(data.slice(0), query);
          if (results.length > 0) {
            const cfi = results[0].cfi;
            await navigateInCluster(bookId, cfi);
            applyTempHighlightForBook(bookId, cfi);
            return;
          }
        }
        if (!(await navigateToChapter(chapterIndex))) {
          console.debug("Ref navigation: no results for query:", query);
        }
      } catch (err) {
        console.warn("Ref navigation failed:", err);
      }
    },
    [
      bookId,
      bookFormat,
      bookDataRef,
      navigateInCluster,
      applyTempHighlightForBook,
      navigateToChapter,
    ],
  );

  return { navigateToQuote, navigateToChapter };
}
