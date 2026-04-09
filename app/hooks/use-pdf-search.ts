import { useEffect, useCallback, useState, useSyncExternalStore } from "react";

interface UsePdfSearchOptions {
  /** Reference to the EventBus from PDFViewer */
  eventBusRef: React.RefObject<any>;
  bookId: string;
  /** When provided, Cmd/Ctrl+F is only intercepted if this element (or a descendant) has focus. */
  panelRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Polls a ref until its `.current` is non-null and returns a stable snapshot.
 * This lets us use eventBusRef.current as a useEffect dependency — the effect
 * re-runs when the ref value changes from null to the actual EventBus instance.
 */
function useRefValue<T>(ref: React.RefObject<T>): T | null {
  const subscribe = useCallback(
    (cb: () => void) => {
      // Poll every 100ms until the ref is assigned
      const id = setInterval(() => {
        cb();
      }, 100);
      return () => clearInterval(id);
    },
    [], // stable — no deps needed
  );
  const getSnapshot = useCallback(() => ref.current, [ref]);
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

interface UsePdfSearchReturn {
  searchOpen: boolean;
  searchQuery: string;
  searchResultCount: number;
  searchIndex: number;
  searchNext: () => void;
  searchPrev: () => void;
  handleSearchOpen: () => void;
  handleSearchClose: () => void;
  handleSearchQueryChange: (query: string) => void;
}

/**
 * Hook that encapsulates PDF full-text search via PDFFindController.
 * Dispatches find events on the EventBus and listens for match count updates.
 */
export function usePdfSearch({
  eventBusRef,
  bookId,
  panelRef,
}: UsePdfSearchOptions): UsePdfSearchReturn {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResultCount, setSearchResultCount] = useState(0);
  const [searchIndex, setSearchIndex] = useState(0);

  // Track when eventBusRef.current becomes available (it's assigned async in use-pdf-lifecycle)
  const eventBus = useRefValue(eventBusRef);

  // Listen for find result updates from PDFFindController
  useEffect(() => {
    if (!eventBus) return;

    const onMatchesCount = (evt: any) => {
      const { matchesCount } = evt;
      if (matchesCount) {
        setSearchResultCount(matchesCount.total || 0);
        setSearchIndex(matchesCount.current ? matchesCount.current - 1 : 0);
      }
    };

    eventBus.on("updatefindmatchescount", onMatchesCount);
    eventBus.on("updatefindcontrolstate", onMatchesCount);

    return () => {
      eventBus.off("updatefindmatchescount", onMatchesCount);
      eventBus.off("updatefindcontrolstate", onMatchesCount);
    };
  }, [eventBus]);

  const dispatchFind = useCallback(
    (query: string, type: string = "") => {
      const eventBus = eventBusRef.current;
      if (!eventBus) return;
      eventBus.dispatch("find", {
        type,
        query,
        caseSensitive: false,
        highlightAll: true,
        findPrevious: type === "findagain" ? false : undefined,
      });
    },
    [eventBusRef],
  );

  const handleSearchQueryChange = useCallback(
    (query: string) => {
      setSearchQuery(query);
      const trimmed = query.trim();
      if (!trimmed) {
        // Clear search
        const eventBus = eventBusRef.current;
        if (eventBus) {
          eventBus.dispatch("find", {
            type: "",
            query: "",
            caseSensitive: false,
            highlightAll: false,
          });
        }
        setSearchResultCount(0);
        setSearchIndex(0);
        return;
      }
      dispatchFind(trimmed);
    },
    [dispatchFind, eventBusRef],
  );

  // Clear search when book changes
  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResultCount(0);
    setSearchIndex(0);
  }, [bookId]);

  const searchNext = useCallback(() => {
    if (!searchQuery.trim()) return;
    const eventBus = eventBusRef.current;
    if (!eventBus) return;
    eventBus.dispatch("find", {
      type: "again",
      query: searchQuery.trim(),
      caseSensitive: false,
      highlightAll: true,
      findPrevious: false,
    });
  }, [searchQuery, eventBusRef]);

  const searchPrev = useCallback(() => {
    if (!searchQuery.trim()) return;
    const eventBus = eventBusRef.current;
    if (!eventBus) return;
    eventBus.dispatch("find", {
      type: "again",
      query: searchQuery.trim(),
      caseSensitive: false,
      highlightAll: true,
      findPrevious: true,
    });
  }, [searchQuery, eventBusRef]);

  const handleSearchOpen = useCallback(() => setSearchOpen(true), []);

  const handleSearchClose = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResultCount(0);
    setSearchIndex(0);
    // Clear find highlights and notify PDFFindController the find bar is closed
    const eb = eventBusRef.current;
    if (eb) {
      eb.dispatch("findbarclose", {});
    }
  }, [eventBusRef]);

  // Intercept Cmd/Ctrl+F
  useEffect(() => {
    const handleFindShortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        if (panelRef) {
          const el = panelRef.current;
          if (!el?.contains(document.activeElement) && document.activeElement !== el) return;
        }
        e.preventDefault();
        e.stopPropagation();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", handleFindShortcut);
    return () => document.removeEventListener("keydown", handleFindShortcut);
  }, [panelRef]);

  return {
    searchOpen,
    searchQuery,
    searchResultCount,
    searchIndex,
    searchNext,
    searchPrev,
    handleSearchOpen,
    handleSearchClose,
    handleSearchQueryChange,
  };
}
