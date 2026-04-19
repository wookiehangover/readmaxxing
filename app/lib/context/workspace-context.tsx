import { createContext, useContext, useRef, useCallback, useMemo, type ReactNode } from "react";
import type { DockviewApi } from "dockview";
import type { TocEntry } from "~/lib/context/reader-context";
import type { BookMeta } from "~/lib/stores/book-store";
import type { JSONContent } from "@tiptap/react";

export interface NotebookEditorCallbacks {
  appendContent: (nodes: JSONContent[]) => void;
  setContent: (content: JSONContent) => void;
  getContent: () => JSONContent;
  getTopLevelNodeCount: () => number;
  replaceContentFrom: (fromIndex: number, nodes: JSONContent[]) => void;
  /**
   * Seed the editor's last-known-content ref to the given content so a
   * subsequent `sync:entity-updated` {notebook} event that reads the same
   * content from IndexedDB is treated as a no-op. Used by chat tool handlers
   * that write-through to IDB and dispatch a sync event while the editor is
   * open, to avoid a redundant `setContent` that would reset cursor position.
   */
  seedLastContent: (content: JSONContent) => void;
}

interface WorkspaceContextValue {
  /** panelId -> navigateToCfi callback */
  navigationMap: React.MutableRefObject<Map<string, (cfi: string) => void>>;
  /** panelId -> TOC entries */
  tocMap: React.MutableRefObject<Map<string, TocEntry[]>>;
  /** bookId -> appendHighlightReference callback */
  notebookCallbackMap: React.MutableRefObject<
    Map<string, (attrs: { highlightId: string; cfiRange: string; text: string }) => void>
  >;
  /** Listener notified when tocMap changes (triggers React re-render) */
  tocChangeListener: React.MutableRefObject<(() => void) | null>;
  /** Listener notified when booksRef changes */
  booksChangeListener: React.MutableRefObject<(() => void) | null>;
  /** DockviewApi instance */
  dockviewApi: React.MutableRefObject<DockviewApi | null>;
  /** File input element for triggering uploads */
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  /** Current books list */
  booksRef: React.MutableRefObject<BookMeta[]>;
  /** Callback to open a book panel */
  openBookRef: React.MutableRefObject<((book: BookMeta) => void) | null>;
  /** Callback to open a notebook panel */
  openNotebookRef: React.MutableRefObject<((book: BookMeta) => void) | null>;
  /** Callback to open a chat panel */
  openChatRef: React.MutableRefObject<((book: BookMeta) => void) | null>;
  /** Callback to open the Standard Ebooks browser panel */
  openStandardEbooksRef: React.MutableRefObject<(() => void) | null>;
  /** Find the navigation callback for a book by scanning dockview panels */
  findNavForBook: (bookId: string) => ((cfi: string) => void) | undefined;
  /** Like findNavForBook but retries with short delays if the callback isn't registered yet */
  waitForNavForBook: (bookId: string) => Promise<((cfi: string) => void) | undefined>;
  /** Callback ref for when a book is added (calls setBooks in workspace.tsx) */
  onBookAddedRef: React.MutableRefObject<((book: BookMeta) => void) | null>;
  /** Callback ref for when a book is deleted (calls setBooks in workspace.tsx) */
  onBookDeletedRef: React.MutableRefObject<((bookId: string) => void) | null>;
  /** bookId -> current chapter context for chat */
  chatContextMap: React.MutableRefObject<
    Map<string, { currentChapterIndex: number; currentSpineHref: string; visibleText: string }>
  >;
  /** Find TOC entries for a book by scanning dockview panels */
  findTocForBook: (bookId: string) => TocEntry[] | undefined;
  /** panelId -> temporary highlight callback */
  tempHighlightMap: React.MutableRefObject<Map<string, (cfi: string) => void>>;
  /** Apply a temporary highlight in the reader for a book */
  applyTempHighlightForBook: (bookId: string, cfi: string) => void;
  /** panelId -> remove highlight annotation from rendition */
  highlightDeleteMap: React.MutableRefObject<Map<string, (cfiRange: string) => void>>;
  /** Remove a highlight annotation from the reader rendition for a book */
  removeHighlightAnnotationForBook: (bookId: string, cfiRange: string) => void;
  /** bookId -> notebook editor callbacks (appendContent, setContent, getContent) for live-sync */
  notebookEditorCallbackMap: React.MutableRefObject<Map<string, NotebookEditorCallbacks>>;
  /** bookId -> callback notified when notebook content changes (user edits or programmatic) */
  notebookContentChangeMap: React.MutableRefObject<Map<string, (markdown: string) => void>>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return ctx;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const navigationMap = useRef(new Map<string, (cfi: string) => void>());
  const tocMap = useRef(new Map<string, TocEntry[]>());
  const notebookCallbackMap = useRef(
    new Map<string, (attrs: { highlightId: string; cfiRange: string; text: string }) => void>(),
  );
  const tocChangeListener = useRef<(() => void) | null>(null);
  const booksChangeListener = useRef<(() => void) | null>(null);
  const dockviewApi = useRef<DockviewApi | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const booksRef = useRef<BookMeta[]>([]);
  const openBookRef = useRef<((book: BookMeta) => void) | null>(null);
  const openNotebookRef = useRef<((book: BookMeta) => void) | null>(null);
  const openChatRef = useRef<((book: BookMeta) => void) | null>(null);
  const openStandardEbooksRef = useRef<(() => void) | null>(null);
  const onBookAddedRef = useRef<((book: BookMeta) => void) | null>(null);
  const onBookDeletedRef = useRef<((bookId: string) => void) | null>(null);
  const chatContextMap = useRef(
    new Map<
      string,
      { currentChapterIndex: number; currentSpineHref: string; visibleText: string }
    >(),
  );
  const tempHighlightMap = useRef(new Map<string, (cfi: string) => void>());
  const highlightDeleteMap = useRef(new Map<string, (cfiRange: string) => void>());
  const notebookEditorCallbackMap = useRef(new Map<string, NotebookEditorCallbacks>());
  const notebookContentChangeMap = useRef(new Map<string, (markdown: string) => void>());

  const findNavForBook = useCallback((bookId: string): ((cfi: string) => void) | undefined => {
    const api = dockviewApi.current;
    if (!api) return undefined;
    for (const panel of api.panels) {
      if (
        panel.id.startsWith("book-") &&
        (panel.params as Record<string, unknown>)?.bookId === bookId
      ) {
        const nav = navigationMap.current.get(panel.id);
        if (nav) return nav;
      }
    }
    return undefined;
  }, []);

  const applyTempHighlightForBook = useCallback((bookId: string, cfi: string): void => {
    const api = dockviewApi.current;
    if (!api) return;
    for (const panel of api.panels) {
      if (
        panel.id.startsWith("book-") &&
        (panel.params as Record<string, unknown>)?.bookId === bookId
      ) {
        const fn = tempHighlightMap.current.get(panel.id);
        if (fn) {
          fn(cfi);
          return;
        }
      }
    }
  }, []);

  const removeHighlightAnnotationForBook = useCallback((bookId: string, cfiRange: string): void => {
    const api = dockviewApi.current;
    if (!api) return;
    for (const panel of api.panels) {
      if (
        panel.id.startsWith("book-") &&
        (panel.params as Record<string, unknown>)?.bookId === bookId
      ) {
        const fn = highlightDeleteMap.current.get(panel.id);
        if (fn) {
          fn(cfiRange);
          return;
        }
      }
    }
  }, []);

  const waitForNavForBook = useCallback(
    async (bookId: string): Promise<((cfi: string) => void) | undefined> => {
      const maxAttempts = 5;
      const delayMs = 500;
      for (let i = 0; i < maxAttempts; i++) {
        const nav = findNavForBook(bookId);
        if (nav) return nav;
        if (i < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
      return undefined;
    },
    [findNavForBook],
  );

  const findTocForBook = useCallback((bookId: string): TocEntry[] | undefined => {
    const api = dockviewApi.current;
    if (!api) return undefined;
    for (const panel of api.panels) {
      if (
        panel.id.startsWith("book-") &&
        (panel.params as Record<string, unknown>)?.bookId === bookId
      ) {
        const toc = tocMap.current.get(panel.id);
        if (toc && toc.length > 0) return toc;
      }
    }
    return undefined;
  }, []);

  const value: WorkspaceContextValue = useMemo(
    () => ({
      navigationMap,
      tocMap,
      notebookCallbackMap,
      tocChangeListener,
      booksChangeListener,
      dockviewApi,
      fileInputRef,
      booksRef,
      openBookRef,
      openNotebookRef,
      openChatRef,
      openStandardEbooksRef,
      onBookAddedRef,
      onBookDeletedRef,
      chatContextMap,
      findNavForBook,
      waitForNavForBook,
      findTocForBook,
      tempHighlightMap,
      applyTempHighlightForBook,
      highlightDeleteMap,
      removeHighlightAnnotationForBook,
      notebookEditorCallbackMap,
      notebookContentChangeMap,
    }),
    [
      findNavForBook,
      waitForNavForBook,
      findTocForBook,
      applyTempHighlightForBook,
      removeHighlightAnnotationForBook,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
