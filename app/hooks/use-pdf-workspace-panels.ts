import { useEffect, useRef, useCallback, useState } from "react";
import { BookService, type BookMeta } from "~/lib/stores/book-store";
import { useWorkspace } from "~/lib/context/workspace-context";
import { extractPdfPageText, extractPdfPageTextFromDoc } from "~/lib/pdf/pdf-text-extract";
import { openMobileReadingTab } from "~/components/reading-shell/mobile-reading-tabs";
import { useReaderDwell, type ReadingDwellUnit } from "~/hooks/use-reader-dwell";
import { useAppStore } from "~/lib/themis/provider";
import { appendHighlightToNotebookRequested } from "~/lib/themis/annotations/annotations-slice";

type SavedHighlight = { id: string; cfiRange: string; text: string };

interface UsePdfWorkspacePanelsOptions {
  book: BookMeta;
  currentPage: number;
  hasRestoredPosition: boolean;
  selectionText?: string;
  pdfDocRef?: React.RefObject<any>;
  saveHighlightFromPopover: () => Promise<SavedHighlight | null>;
  applyTempHighlight: (text: string) => void;
  removeHighlight: (cfiRange: string) => void;
  dismissPopovers: () => void;
  handleOpenNotebookRef: React.MutableRefObject<() => void>;
}

export function usePdfWorkspacePanels({
  book,
  currentPage,
  hasRestoredPosition,
  selectionText,
  pdfDocRef,
  saveHighlightFromPopover,
  applyTempHighlight,
  removeHighlight,
  dismissPopovers,
  handleOpenNotebookRef,
}: UsePdfWorkspacePanelsOptions) {
  const ws = useWorkspace();
  const store = useAppStore();
  const {
    navigationMap,
    notebookCallbackMap,
    notebookEditorCallbackMap,
    chatContextMap,
    pendingHighlightPillMap,
    tempHighlightMap,
    highlightDeleteMap,
  } = ws;
  const [readingDwellUnit, setReadingDwellUnit] = useState<ReadingDwellUnit | null>(null);
  useReaderDwell({
    bookId: book.id,
    unit: readingDwellUnit,
    enabled: hasRestoredPosition,
  });

  // Register navigation callback for PDF (accepts "page:N" format or page number string)
  const goToPageRef = useRef<(page: number) => void>(() => {});

  const setGoToPage = useCallback((fn: (page: number) => void) => {
    goToPageRef.current = fn;
  }, []);

  useEffect(() => {
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
    navigationMap.current.set(book.id, navigatePdf);
    return () => {
      navigationMap.current.delete(book.id);
    };
  }, [book.id, navigationMap]);

  // Register temp highlight callback
  useEffect(() => {
    tempHighlightMap.current.set(book.id, applyTempHighlight);
    return () => {
      tempHighlightMap.current.delete(book.id);
    };
  }, [book.id, applyTempHighlight, tempHighlightMap]);

  // Register highlight delete callback
  useEffect(() => {
    highlightDeleteMap.current.set(book.id, removeHighlight);
    return () => {
      highlightDeleteMap.current.delete(book.id);
    };
  }, [book.id, removeHighlight, highlightDeleteMap]);

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
    store.dispatch(
      appendHighlightToNotebookRequested(book.id, attrs, undefined, (error) =>
        console.error("Failed to append highlight to notebook:", error),
      ),
    );
  }, [saveHighlightFromPopover, notebookCallbackMap, book.id, store]);

  const handleAskQuestion = useCallback(async () => {
    try {
      const highlight = await saveHighlightFromPopover();
      if (!highlight) return;

      const attrs = {
        highlightId: highlight.id,
        cfiRange: highlight.cfiRange,
        text: highlight.text,
      };
      const editorCallbacks = notebookEditorCallbackMap.current.get(book.id);
      if (editorCallbacks) {
        editorCallbacks.appendContent([
          { type: "highlightReference", attrs },
          { type: "paragraph" },
        ]);
      } else {
        store.dispatch(
          appendHighlightToNotebookRequested(book.id, attrs, undefined, (error) =>
            console.error("Failed to append highlight to notebook:", error),
          ),
        );
      }

      pendingHighlightPillMap.current.set(book.id, {
        text: highlight.text,
        pageLabel: `p${currentPage}`,
      });
      openMobileReadingTab("Discuss");
      ws.openChatRef.current?.(book);
      dismissPopovers();
      window.getSelection()?.removeAllRanges();
    } catch (err) {
      console.error("Failed to handle ask question:", err);
    }
  }, [
    book,
    currentPage,
    dismissPopovers,
    notebookEditorCallbackMap,
    pendingHighlightPillMap,
    saveHighlightFromPopover,
    store,
    ws.openChatRef,
  ]);

  const handleExplainThis = useCallback(() => {
    const quote = selectionText;
    if (!quote) return;

    const message = `Explain this passage:\n\n${quote
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")}`;
    ws.pendingChatPromptMap.current.set(book.id, message);
    openMobileReadingTab("Discuss");
    ws.openChatRef.current?.(book);
    queueMicrotask(() => {
      window.dispatchEvent(
        new CustomEvent("chat:explain", { detail: { bookId: book.id, message } }),
      );
    });
    dismissPopovers();
    window.getSelection()?.removeAllRanges();
  }, [book, dismissPopovers, selectionText, ws.openChatRef, ws.pendingChatPromptMap]);

  // Delegate to the workspace-level openers so focused-mode cluster rules
  // (add-tab in right group, no splitting) are applied uniformly.
  const handleOpenNotebook = useCallback(() => {
    openMobileReadingTab("Notes");
    ws.openNotebookRef.current?.(book);
  }, [ws, book]);

  // Keep ref in sync so usePdfHighlights click handler always calls latest version
  handleOpenNotebookRef.current = handleOpenNotebook;

  const handleOpenChat = useCallback(() => {
    openMobileReadingTab("Discuss");
    ws.openChatRef.current?.(book);
  }, [ws, book]);

  // Populate chatContextMap with current page text for AI chat
  // Prefer the already-loaded pdfDocRef to avoid re-creating the document per page
  const bookDataRef = useRef<ArrayBuffer | null>(null);
  useEffect(() => {
    // Only load book data as fallback when pdfDocRef is not available
    if (pdfDocRef) return;
    BookService.getBookData(book.id)
      .then((data) => {
        bookDataRef.current = data;
      })
      .catch(console.error);
  }, [book.id, pdfDocRef]);

  useEffect(() => {
    setReadingDwellUnit(null);
    if (currentPage < 1 || !hasRestoredPosition) return;

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
          setReadingDwellUnit({
            unitKind: "pdf-page",
            locator: `page:${currentPage}`,
            text,
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
          setReadingDwellUnit({
            unitKind: "pdf-page",
            locator: `page:${currentPage}`,
            text,
          });
        })
        .catch(console.error);
    }

    return () => {
      cancelled = true;
    };
  }, [book.id, currentPage, chatContextMap, hasRestoredPosition, pdfDocRef]);

  // Clean up chatContextMap on unmount
  useEffect(() => {
    return () => {
      chatContextMap.current.delete(book.id);
    };
  }, [book.id, chatContextMap]);

  return {
    handleSaveHighlight,
    handleAskQuestion,
    handleExplainThis,
    handleOpenNotebook,
    handleOpenChat,
    setGoToPage,
  };
}
