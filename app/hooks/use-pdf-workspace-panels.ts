import { useEffect, useRef, useCallback } from "react";
import { Effect } from "effect";
import { BookService, type BookMeta } from "~/lib/book-store";
import { useWorkspace } from "~/lib/workspace-context";
import { AppRuntime } from "~/lib/effect-runtime";
import { extractPdfPageText, extractPdfPageTextFromDoc } from "~/lib/pdf-text-extract";
import { useIsMobile } from "~/hooks/use-mobile";
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
  const {
    navigationMap,
    dockviewApi,
    notebookCallbackMap,
    chatContextMap,
    tempHighlightMap,
    highlightDeleteMap,
  } = useWorkspace();
  const isMobile = useIsMobile();

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
    if (highlight) {
      const appendFn = notebookCallbackMap.current.get(book.id);
      if (appendFn) {
        appendFn({
          highlightId: highlight.id,
          cfiRange: highlight.cfiRange,
          text: highlight.text,
        });
      }
    }
  }, [saveHighlightFromPopover, notebookCallbackMap, book.id]);

  const handleOpenNotebook = useCallback(() => {
    const dockApi = dockviewApi.current;
    if (!dockApi || !panelApi) return;

    const panelId = `notebook-${book.id}`;
    const existing = dockApi.panels.find((p) => p.id === panelId);
    if (existing) {
      existing.focus();
      return;
    }

    const title = book.title ?? "Untitled";

    if (isMobile) {
      dockApi.addPanel({
        id: panelId,
        component: "notebook",
        title: `Notes: ${title}`.slice(0, 30),
        params: { bookId: book.id, bookTitle: title },
        renderer: "always",
      });
      return;
    }

    const bookGroup = panelApi.group;
    const bookRect = bookGroup.element.getBoundingClientRect();
    const rightGroup = dockApi.groups.find(
      (g) => g !== bookGroup && g.element.getBoundingClientRect().left >= bookRect.right - 1,
    );

    dockApi.addPanel({
      id: panelId,
      component: "notebook",
      title: `Notes: ${title}`.slice(0, 30),
      params: { bookId: book.id, bookTitle: title },
      renderer: "always",
      position: rightGroup
        ? { referenceGroup: rightGroup }
        : { referencePanel: panelApi.id, direction: "right" as const },
    });
  }, [dockviewApi, book.id, book.title, panelApi, isMobile]);

  // Keep ref in sync so usePdfHighlights click handler always calls latest version
  handleOpenNotebookRef.current = handleOpenNotebook;

  const handleOpenChat = useCallback(() => {
    const dockApi = dockviewApi.current;
    if (!dockApi || !panelApi) return;

    const chatPanelId = `chat-${book.id}`;
    const existing = dockApi.panels.find((p) => p.id === chatPanelId);
    if (existing) {
      existing.focus();
      return;
    }

    const title = book.title ?? "Untitled";

    if (isMobile) {
      dockApi.addPanel({
        id: chatPanelId,
        component: "chat",
        title: `Chat: ${title}`.slice(0, 30),
        params: { bookId: book.id, bookTitle: title },
        renderer: "always",
      });
      return;
    }

    const bookGroup = panelApi.group;
    const bookRect = bookGroup.element.getBoundingClientRect();
    const rightGroup = dockApi.groups.find(
      (g) => g !== bookGroup && g.element.getBoundingClientRect().left >= bookRect.right - 1,
    );

    dockApi.addPanel({
      id: chatPanelId,
      component: "chat",
      title: `Chat: ${title}`.slice(0, 30),
      params: { bookId: book.id, bookTitle: title },
      renderer: "always",
      position: rightGroup
        ? { referenceGroup: rightGroup }
        : { referencePanel: panelApi.id, direction: "right" as const },
    });
  }, [dockviewApi, book.id, book.title, panelApi, isMobile]);

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
