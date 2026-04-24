import { useEffect, useRef, useCallback } from "react";
import { Effect } from "effect";
import { BookService, type BookMeta } from "~/lib/stores/book-store";
import { useWorkspace } from "~/lib/context/workspace-context";
import { AppRuntime } from "~/lib/effect-runtime";
import { extractPdfPageText, extractPdfPageTextFromDoc } from "~/lib/pdf/pdf-text-extract";
import { appendHighlightReferenceToNotebook } from "~/lib/annotations/append-highlight-to-notebook";
import type { DockviewPanelApi } from "dockview";

interface UsePdfWorkspacePanelsOptions {
  book: BookMeta;
  panelApi?: DockviewPanelApi;
  currentPage: number;
  pdfDocRef?: React.RefObject<any>;
  saveHighlightFromPopover: () => Promise<{ id: string; cfiRange: string; text: string } | null>;
  applyTempHighlight: (text: string) => void;
  removeHighlight: (cfiRange: string) => void;
  handleOpenNotebookRef: React.MutableRefObject<() => void>;
}

export function usePdfWorkspacePanels({
  book,
  panelApi,
  currentPage,
  pdfDocRef,
  saveHighlightFromPopover,
  applyTempHighlight,
  removeHighlight,
  handleOpenNotebookRef,
}: UsePdfWorkspacePanelsOptions) {
  const ws = useWorkspace();
  const {
    navigationMap,
    notebookCallbackMap,
    chatContextMap,
    tempHighlightMap,
    highlightDeleteMap,
  } = ws;

  // Register navigation callback for PDF (accepts "page:N" format or page number string)
  const goToPageRef = useRef<(page: number) => void>(() => {});

  const setGoToPage = useCallback((fn: (page: number) => void) => {
    goToPageRef.current = fn;
  }, []);

  useEffect(() => {
    const id = panelApi?.id ?? book.id;
    const navigatePdf = (target: string) => {
      const pageMatch = target.match(/^page:(\d+)$/);
      if (pageMatch) {
        goToPageRef.current(parseInt(pageMatch[1], 10));
        return;
      }
      const pageNum = parseInt(target, 10);
      if (!isNaN(pageNum)) {
        goToPageRef.current(pageNum);
      }
    };
    navigationMap.current.set(id, navigatePdf);
    return () => {
      navigationMap.current.delete(id);
    };
  }, [book.id, panelApi, navigationMap]);

  // Register temp highlight callback
  useEffect(() => {
    const id = panelApi?.id ?? book.id;
    tempHighlightMap.current.set(id, applyTempHighlight);
    return () => {
      tempHighlightMap.current.delete(id);
    };
  }, [book.id, panelApi, applyTempHighlight, tempHighlightMap]);

  // Register highlight delete callback
  useEffect(() => {
    const id = panelApi?.id ?? book.id;
    highlightDeleteMap.current.set(id, removeHighlight);
    return () => {
      highlightDeleteMap.current.delete(id);
    };
  }, [book.id, panelApi, removeHighlight, highlightDeleteMap]);

  const handleSaveHighlight = useCallback(async () => {
    const highlight = await saveHighlightFromPopover();
    if (!highlight) return;
    const attrs = {
      highlightId: highlight.id,
      cfiRange: highlight.cfiRange,
      text: highlight.text,
    };
    const appendFn = notebookCallbackMap.current.get(book.id);
    if (appendFn) {
      appendFn(attrs);
      return;
    }
    // Notebook panel isn't mounted — write the reference directly to IDB so
    // the highlight is visible (and deletable) the next time the notebook
    // opens, instead of silently orphaning it.
    AppRuntime.runPromise(appendHighlightReferenceToNotebook(book.id, attrs))
      .then(() => {
        queueMicrotask(() => {
          window.dispatchEvent(
            new CustomEvent("sync:entity-updated", { detail: { entity: "notebook" } }),
          );
        });
      })
      .catch((err) => console.error("Failed to append highlight to notebook:", err));
  }, [saveHighlightFromPopover, notebookCallbackMap, book.id]);

  // Delegate to the workspace-level openers so focused-mode cluster rules
  // (add-tab in right group, no splitting) are applied uniformly.
  const handleOpenNotebook = useCallback(() => {
    ws.openNotebookRef.current?.(book);
  }, [ws, book]);

  // Keep ref in sync so usePdfHighlights click handler always calls latest version
  handleOpenNotebookRef.current = handleOpenNotebook;

  const handleOpenChat = useCallback(() => {
    ws.openChatRef.current?.(book);
  }, [ws, book]);

  // Populate chatContextMap with current page text for AI chat
  // Prefer the already-loaded pdfDocRef to avoid re-creating the document per page
  const bookDataRef = useRef<ArrayBuffer | null>(null);
  useEffect(() => {
    // Only load book data as fallback when pdfDocRef is not available
    if (pdfDocRef) return;
    AppRuntime.runPromise(BookService.pipe(Effect.andThen((s) => s.getBookData(book.id))))
      .then((data) => {
        bookDataRef.current = data;
      })
      .catch(console.error);
  }, [book.id, pdfDocRef]);

  useEffect(() => {
    if (currentPage < 1) return;

    let cancelled = false;
    const doc = pdfDocRef?.current;

    if (doc) {
      // Fast path: reuse the already-loaded PDF document
      extractPdfPageTextFromDoc(doc, currentPage)
        .then((text) => {
          if (cancelled) return;
          chatContextMap.current.set(book.id, {
            currentChapterIndex: currentPage - 1,
            currentSpineHref: `page:${currentPage}`,
            visibleText: text,
          });
        })
        .catch(console.error);
    } else {
      // Fallback: create a new document from raw data
      const data = bookDataRef.current;
      if (!data) return;
      extractPdfPageText(data, currentPage)
        .then((text) => {
          if (cancelled) return;
          chatContextMap.current.set(book.id, {
            currentChapterIndex: currentPage - 1,
            currentSpineHref: `page:${currentPage}`,
            visibleText: text,
          });
        })
        .catch(console.error);
    }

    return () => {
      cancelled = true;
    };
  }, [book.id, currentPage, chatContextMap, pdfDocRef]);

  // Clean up chatContextMap on unmount
  useEffect(() => {
    return () => {
      chatContextMap.current.delete(book.id);
    };
  }, [book.id, chatContextMap]);

  return {
    handleSaveHighlight,
    handleOpenNotebook,
    handleOpenChat,
    setGoToPage,
  };
}
