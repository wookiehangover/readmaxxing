import { createContext, useContext, useRef, useCallback, type ReactNode } from "react";
import type { DockviewApi } from "dockview";
import type { TocEntry } from "~/lib/reader-context";
import type { Book } from "~/lib/book-store";

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
  booksRef: React.MutableRefObject<Book[]>;
  /** Callback to open a book panel */
  openBookRef: React.MutableRefObject<((book: Book) => void) | null>;
  /** Callback to open a notebook panel */
  openNotebookRef: React.MutableRefObject<((book: Book) => void) | null>;
  /** Callback to open a chat panel */
  openChatRef: React.MutableRefObject<((book: Book) => void) | null>;
  /** Callback to open the Standard Ebooks browser panel */
  openStandardEbooksRef: React.MutableRefObject<(() => void) | null>;
  /** Find the navigation callback for a book by scanning dockview panels */
  findNavForBook: (bookId: string) => ((cfi: string) => void) | undefined;
  /** Callback ref for when a book is added (calls setBooks in workspace.tsx) */
  onBookAddedRef: React.MutableRefObject<((book: Book) => void) | null>;
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
  const booksRef = useRef<Book[]>([]);
  const openBookRef = useRef<((book: Book) => void) | null>(null);
  const openNotebookRef = useRef<((book: Book) => void) | null>(null);
  const openChatRef = useRef<((book: Book) => void) | null>(null);
  const openStandardEbooksRef = useRef<(() => void) | null>(null);
  const onBookAddedRef = useRef<((book: Book) => void) | null>(null);
  const onBookDeletedRef = useRef<((bookId: string) => void) | null>(null);
  const chatContextMap = useRef(
    new Map<string, { currentChapterIndex: number; currentSpineHref: string; visibleText: string }>(),
  );
  const tempHighlightMap = useRef(new Map<string, (cfi: string) => void>());

  const findNavForBook = useCallback(
    (bookId: string): ((cfi: string) => void) | undefined => {
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
    },
    [],
  );

  const applyTempHighlightForBook = useCallback(
    (bookId: string, cfi: string): void => {
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
    },
    [],
  );

  const findTocForBook = useCallback(
    (bookId: string): TocEntry[] | undefined => {
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
    },
    [],
  );

  const value: WorkspaceContextValue = {
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
    findTocForBook,
    tempHighlightMap,
    applyTempHighlightForBook,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
