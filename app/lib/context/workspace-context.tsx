import { createContext, useContext, useRef, useCallback, useMemo, type ReactNode } from "react";
import type { TocEntry } from "~/lib/context/reader-context";
import type { BookMeta } from "~/lib/stores/book-store";
import type { JSONContent } from "@tiptap/react";

export interface NotebookEditorCallbacks {
  appendContent: (nodes: JSONContent[]) => void;
  setContent: (content: JSONContent) => void;
  getContent: () => JSONContent;
  getTopLevelNodeCount: () => number;
  replaceContentFrom: (fromIndex: number, nodes: JSONContent[]) => void;
  removeHighlightReference: (highlightId: string) => void;
  seedLastContent: (content: JSONContent) => void;
}

export interface BookCluster {
  readonly bookPanelId: string;
  readonly chatPanelId?: string;
  readonly notebookPanelId?: string;
}

export interface ReadingLocation {
  readonly chapterLabel: string | null;
  readonly currentPage: number | null;
  readonly totalPages: number | null;
}

export interface WorkspaceContextValue {
  navigationMap: React.MutableRefObject<Map<string, (cfi: string) => void>>;
  tocMap: React.MutableRefObject<Map<string, TocEntry[]>>;
  tocNavigationMap: React.MutableRefObject<Map<string, (href: string) => void>>;
  notebookCallbackMap: React.MutableRefObject<
    Map<string, (attrs: { highlightId: string; cfiRange: string; text: string }) => void>
  >;
  tocChangeListener: React.MutableRefObject<(() => void) | null>;
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  booksRef: React.MutableRefObject<BookMeta[]>;
  openBookIdsRef: React.MutableRefObject<Set<string>>;
  openBookRef: React.MutableRefObject<((book: BookMeta) => void) | null>;
  openNotebookRef: React.MutableRefObject<((book: BookMeta) => void) | null>;
  openChatRef: React.MutableRefObject<((book: BookMeta) => void) | null>;
  openStandardEbooksRef: React.MutableRefObject<(() => void) | null>;
  findNavForBook: (bookId: string) => ((cfi: string) => void) | undefined;
  findTocNavigationForBook: (bookId: string) => ((href: string) => void) | undefined;
  waitForNavForBook: (bookId: string) => Promise<((cfi: string) => void) | undefined>;
  onBookAddedRef: React.MutableRefObject<((book: BookMeta) => void) | null>;
  onBookDeletedRef: React.MutableRefObject<((bookId: string) => void) | null>;
  chatContextMap: React.MutableRefObject<
    Map<string, { currentChapterIndex: number; currentSpineHref: string; visibleText: string }>
  >;
  pendingHighlightPillMap: React.MutableRefObject<Map<string, { text: string; pageLabel: string }>>;
  pendingChatPromptMap: React.MutableRefObject<Map<string, string>>;
  findTocForBook: (bookId: string) => TocEntry[] | undefined;
  tempHighlightMap: React.MutableRefObject<Map<string, (cfi: string) => void>>;
  applyTempHighlightForBook: (bookId: string, cfi: string) => void;
  highlightDeleteMap: React.MutableRefObject<Map<string, (cfiRange: string) => void>>;
  removeHighlightAnnotationForBook: (bookId: string, cfiRange: string) => void;
  notebookEditorCallbackMap: React.MutableRefObject<Map<string, NotebookEditorCallbacks>>;
  notebookContentChangeMap: React.MutableRefObject<Map<string, (markdown: string) => void>>;
  getReadingLocation: (bookId: string | null) => ReadingLocation | null;
  setReadingLocation: (bookId: string, location: ReadingLocation) => void;
  subscribeReadingLocations: (listener: () => void) => () => void;
  clustersRef: React.MutableRefObject<Map<string, BookCluster>>;
  activeClusterBookIdRef: React.MutableRefObject<string | null>;
  notifyClusterChanges: () => void;
  subscribeClusterChanges: (listener: () => void) => () => void;
  getClusterForBook: (bookId: string) => BookCluster | undefined;
  getClusterForPanel: (panelId: string) => { bookId: string; cluster: BookCluster } | undefined;
  setActiveCluster: (bookId: string | null) => void;
  navigateInCluster: (bookId: string, target: string) => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return ctx;
}

export function useOptionalWorkspace(): WorkspaceContextValue | null {
  return useContext(WorkspaceContext);
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const navigationMap = useRef(new Map<string, (cfi: string) => void>());
  const tocMap = useRef(new Map<string, TocEntry[]>());
  const tocNavigationMap = useRef(new Map<string, (href: string) => void>());
  const notebookCallbackMap = useRef(
    new Map<string, (attrs: { highlightId: string; cfiRange: string; text: string }) => void>(),
  );
  const tocChangeListener = useRef<(() => void) | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const booksRef = useRef<BookMeta[]>([]);
  const openBookIdsRef = useRef<Set<string>>(new Set());
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
  const pendingHighlightPillMap = useRef(new Map<string, { text: string; pageLabel: string }>());
  const pendingChatPromptMap = useRef(new Map<string, string>());
  const tempHighlightMap = useRef(new Map<string, (cfi: string) => void>());
  const highlightDeleteMap = useRef(new Map<string, (cfiRange: string) => void>());
  const notebookEditorCallbackMap = useRef(new Map<string, NotebookEditorCallbacks>());
  const notebookContentChangeMap = useRef(new Map<string, (markdown: string) => void>());
  const readingLocationMap = useRef(new Map<string, ReadingLocation>());
  const readingLocationListenersRef = useRef(new Set<() => void>());
  const clustersRef = useRef(new Map<string, BookCluster>());
  const activeClusterBookIdRef = useRef<string | null>(null);
  const clusterListenersRef = useRef(new Set<() => void>());

  const notifyClusterChanges = useCallback(() => {
    for (const fn of clusterListenersRef.current) fn();
  }, []);

  const subscribeClusterChanges = useCallback((listener: () => void) => {
    clusterListenersRef.current.add(listener);
    return () => {
      clusterListenersRef.current.delete(listener);
    };
  }, []);

  const getReadingLocation = useCallback((bookId: string | null): ReadingLocation | null => {
    return bookId ? (readingLocationMap.current.get(bookId) ?? null) : null;
  }, []);

  const setReadingLocation = useCallback((bookId: string, location: ReadingLocation) => {
    const current = readingLocationMap.current.get(bookId);
    if (
      current?.chapterLabel === location.chapterLabel &&
      current.currentPage === location.currentPage &&
      current.totalPages === location.totalPages
    ) {
      return;
    }
    readingLocationMap.current.set(bookId, location);
    for (const listener of readingLocationListenersRef.current) listener();
  }, []);

  const subscribeReadingLocations = useCallback((listener: () => void) => {
    readingLocationListenersRef.current.add(listener);
    return () => {
      readingLocationListenersRef.current.delete(listener);
    };
  }, []);

  const getClusterForBook = useCallback((bookId: string): BookCluster | undefined => {
    return clustersRef.current.get(bookId);
  }, []);

  const getClusterForPanel = useCallback(
    (panelId: string): { bookId: string; cluster: BookCluster } | undefined => {
      for (const [bookId, cluster] of clustersRef.current) {
        if (
          cluster.bookPanelId === panelId ||
          cluster.chatPanelId === panelId ||
          cluster.notebookPanelId === panelId
        ) {
          return { bookId, cluster };
        }
      }
      return undefined;
    },
    [],
  );

  const setActiveCluster = useCallback(
    (bookId: string | null): void => {
      if (activeClusterBookIdRef.current === bookId) return;
      activeClusterBookIdRef.current = bookId;
      notifyClusterChanges();
    },
    [notifyClusterChanges],
  );

  const findNavForBook = useCallback((bookId: string): ((cfi: string) => void) | undefined => {
    return navigationMap.current.get(bookId);
  }, []);

  const applyTempHighlightForBook = useCallback((bookId: string, cfi: string): void => {
    tempHighlightMap.current.get(bookId)?.(cfi);
  }, []);

  const removeHighlightAnnotationForBook = useCallback((bookId: string, cfiRange: string): void => {
    highlightDeleteMap.current.get(bookId)?.(cfiRange);
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

  const navigateInCluster = useCallback(
    async (bookId: string, target: string): Promise<void> => {
      if (activeClusterBookIdRef.current !== bookId) {
        setActiveCluster(bookId);
      }

      const nav = await waitForNavForBook(bookId);
      if (nav) nav(target);
    },
    [setActiveCluster, waitForNavForBook],
  );

  const findTocForBook = useCallback((bookId: string): TocEntry[] | undefined => {
    const toc = tocMap.current.get(bookId);
    return toc && toc.length > 0 ? toc : undefined;
  }, []);

  const findTocNavigationForBook = useCallback(
    (bookId: string) => tocNavigationMap.current.get(bookId),
    [],
  );

  const value: WorkspaceContextValue = useMemo(
    () => ({
      navigationMap,
      tocMap,
      tocNavigationMap,
      notebookCallbackMap,
      tocChangeListener,
      fileInputRef,
      booksRef,
      openBookIdsRef,
      openBookRef,
      openNotebookRef,
      openChatRef,
      openStandardEbooksRef,
      onBookAddedRef,
      onBookDeletedRef,
      chatContextMap,
      pendingHighlightPillMap,
      pendingChatPromptMap,
      findNavForBook,
      findTocNavigationForBook,
      waitForNavForBook,
      findTocForBook,
      tempHighlightMap,
      applyTempHighlightForBook,
      highlightDeleteMap,
      removeHighlightAnnotationForBook,
      notebookEditorCallbackMap,
      notebookContentChangeMap,
      getReadingLocation,
      setReadingLocation,
      subscribeReadingLocations,
      clustersRef,
      activeClusterBookIdRef,
      notifyClusterChanges,
      subscribeClusterChanges,
      getClusterForBook,
      getClusterForPanel,
      setActiveCluster,
      navigateInCluster,
    }),
    [
      findNavForBook,
      waitForNavForBook,
      findTocForBook,
      applyTempHighlightForBook,
      removeHighlightAnnotationForBook,
      getReadingLocation,
      setReadingLocation,
      subscribeReadingLocations,
      notifyClusterChanges,
      subscribeClusterChanges,
      getClusterForBook,
      getClusterForPanel,
      setActiveCluster,
      navigateInCluster,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
