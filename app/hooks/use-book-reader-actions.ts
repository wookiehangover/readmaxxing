import { useCallback } from "react";
import type { Bookmark as BookmarkRecord } from "~/lib/stores/bookmark-store";
import type { BookMeta } from "~/lib/stores/book-store";
import type { SelectionPopover, useHighlights } from "~/hooks/use-highlights";
import { openMobileReadingTab } from "~/components/reading-shell/mobile-reading-tabs";
import type { SuccessorRenditionAdapter } from "~/lib/epub/successor-reader-adapter";
import { useWorkspace } from "~/lib/context/workspace-context";
import { tokenizeSpeedreadText } from "~/lib/speedread";
import { BookService } from "~/lib/stores/book-store";
import { useAppStore } from "~/lib/themis/provider";
import { appendHighlightToNotebookRequested } from "~/lib/themis/annotations/annotations-slice";
import {
  addBookmarkRequested,
  deleteBookmarkRequested,
} from "~/lib/themis/bookmarks/bookmarks-slice";

type HighlightsState = ReturnType<typeof useHighlights>;

interface UseBookReaderActionsOptions {
  book: BookMeta;
  bookmarks: BookmarkRecord[];
  bookmarksLoaded: boolean;
  currentChapterLabel: string | null;
  currentPage: number | null;
  latestCfiRef: React.MutableRefObject<string | null>;
  renditionRef: React.RefObject<SuccessorRenditionAdapter | null>;
  selectionPopover: SelectionPopover | null;
  saveHighlightFromPopover: HighlightsState["saveHighlight"];
  dismissPopovers: HighlightsState["dismissPopovers"];
  setSpeedreadWords: React.Dispatch<React.SetStateAction<string[]>>;
  setSpeedreadOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useBookReaderActions({
  book,
  bookmarks,
  bookmarksLoaded,
  currentChapterLabel,
  currentPage,
  latestCfiRef,
  renditionRef,
  selectionPopover,
  saveHighlightFromPopover,
  dismissPopovers,
  setSpeedreadWords,
  setSpeedreadOpen,
}: UseBookReaderActionsOptions) {
  const workspace = useWorkspace();
  const store = useAppStore();

  const clearSelection = useCallback(() => {
    const contents = renditionRef.current?.getContents?.() ?? [];
    contents.forEach((content) => {
      content.document?.defaultView?.getSelection()?.removeAllRanges();
    });
  }, [renditionRef]);

  const handleSaveHighlight = useCallback(async () => {
    const highlight = await saveHighlightFromPopover();
    if (!highlight) return;
    const attributes = {
      highlightId: highlight.id,
      cfiRange: highlight.cfiRange,
      text: highlight.text,
    };
    const append = workspace.notebookCallbackMap.current.get(book.id);
    if (append) {
      append(attributes);
      return;
    }
    store.dispatch(
      appendHighlightToNotebookRequested(book.id, attributes, undefined, (error) =>
        console.error("Failed to append highlight to notebook:", error),
      ),
    );
  }, [book.id, saveHighlightFromPopover, store, workspace.notebookCallbackMap]);

  const handleAskQuestion = useCallback(async () => {
    if (!selectionPopover) return;

    try {
      const highlight = await saveHighlightFromPopover();
      if (!highlight) return;
      const attributes = {
        highlightId: highlight.id,
        cfiRange: highlight.cfiRange,
        text: highlight.text,
      };
      const editorCallbacks = workspace.notebookEditorCallbackMap.current.get(book.id);
      if (editorCallbacks) {
        editorCallbacks.appendContent([
          { type: "highlightReference", attrs: attributes },
          { type: "paragraph" },
        ]);
      } else {
        store.dispatch(
          appendHighlightToNotebookRequested(book.id, attributes, undefined, (error) =>
            console.error("Failed to append highlight to notebook:", error),
          ),
        );
      }

      workspace.pendingHighlightPillMap.current.set(book.id, {
        text: selectionPopover.text,
        pageLabel: currentPage ? `p${currentPage}` : "",
      });
      openMobileReadingTab("Discuss");
      workspace.openChatRef.current?.(book);
    } catch (error) {
      console.error("Failed to ask a question about highlight:", error);
    } finally {
      dismissPopovers();
      clearSelection();
    }
  }, [
    book,
    clearSelection,
    currentPage,
    dismissPopovers,
    saveHighlightFromPopover,
    selectionPopover,
    store,
    workspace,
  ]);

  const handleExplainThis = useCallback(() => {
    const quote = selectionPopover?.text;
    if (!quote) return;
    const message = `Explain this passage:\n\n${quote
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")}`;
    workspace.pendingChatPromptMap.current.set(book.id, message);
    openMobileReadingTab("Discuss");
    workspace.openChatRef.current?.(book);
    queueMicrotask(() => {
      window.dispatchEvent(
        new CustomEvent("chat:explain", { detail: { bookId: book.id, message } }),
      );
    });
    dismissPopovers();
    clearSelection();
  }, [book, clearSelection, dismissPopovers, selectionPopover, workspace]);

  const handleCopyAsMarkdown = useCallback(async () => {
    if (!selectionPopover) return;
    await navigator.clipboard.writeText(selectionPopover.text);
    dismissPopovers();
    clearSelection();
  }, [clearSelection, dismissPopovers, selectionPopover]);

  const handleDownload = useCallback(() => {
    BookService.getBookData(book.id)
      .catch((error: unknown) => {
        console.error("Failed to download book:", error);
        return null;
      })
      .then((data) => {
        if (!data) return;
        const format = book.format ?? "epub";
        const type = format === "pdf" ? "application/pdf" : "application/epub+zip";
        const blob = new Blob([data], { type });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${book.title.replace(/[\\/:*?"<>|]/g, "-")}.${format}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      })
      .catch(console.error);
  }, [book.format, book.id, book.title]);

  const handleCopyPageAsMarkdown = useCallback(() => {
    const text = renditionRef.current
      ?.getContents()
      .map((content) => content.document?.body?.innerText ?? "")
      .join("\n\n")
      .trim();
    if (text) navigator.clipboard.writeText(text).catch(console.error);
  }, [renditionRef]);

  const handleOpenSpeedread = useCallback(() => {
    if (renditionRef.current?.navigator?.allowsMovement("speedread") === false) return;
    const text = (renditionRef.current?.getContents?.() ?? [])
      .map((content) => content.document?.body?.innerText ?? "")
      .join("\n\n");
    setSpeedreadWords(tokenizeSpeedreadText(text));
    setSpeedreadOpen(true);
  }, [renditionRef, setSpeedreadOpen, setSpeedreadWords]);

  const getCurrentCfi = useCallback(() => {
    if (latestCfiRef.current) return latestCfiRef.current;
    const rendition = renditionRef.current;
    let location = rendition?.location;
    if (!location) {
      try {
        location = rendition?.currentLocation?.();
      } catch {
        // The reader may be torn down while navigation is settling.
      }
    }
    return location?.start?.cfi ?? null;
  }, [latestCfiRef, renditionRef]);

  const currentBookmark = bookmarks.find((bookmark) => bookmark.cfi === getCurrentCfi());
  const handleBookmarkPage = useCallback(() => {
    if (!bookmarksLoaded) return;
    const cfi = getCurrentCfi();
    if (!cfi) return;
    const existingBookmark = bookmarks.find((bookmark) => bookmark.cfi === cfi);
    const now = Date.now();
    store.dispatch(
      existingBookmark
        ? deleteBookmarkRequested(book.id, existingBookmark.id)
        : addBookmarkRequested({
            id: `bookmark:${book.id}:cfi:${encodeURIComponent(cfi)}`,
            bookId: book.id,
            cfi,
            label: currentChapterLabel ?? undefined,
            displayPage: currentPage ?? undefined,
            createdAt: now,
            updatedAt: now,
          }),
    );
  }, [book.id, bookmarks, bookmarksLoaded, currentChapterLabel, currentPage, getCurrentCfi, store]);

  const handleOpenNotebook = useCallback(() => {
    openMobileReadingTab("Notes");
    workspace.openNotebookRef.current?.(book);
  }, [book, workspace.openNotebookRef]);
  const handleOpenChat = useCallback(() => {
    openMobileReadingTab("Discuss");
    workspace.openChatRef.current?.(book);
  }, [book, workspace.openChatRef]);

  return {
    currentBookmark,
    handleSaveHighlight,
    handleAskQuestion,
    handleExplainThis,
    handleCopyAsMarkdown,
    handleDownload,
    handleCopyPageAsMarkdown,
    handleOpenSpeedread,
    handleBookmarkPage,
    handleOpenNotebook,
    handleOpenChat,
  };
}
