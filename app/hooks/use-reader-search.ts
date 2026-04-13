import { useEffect, useRef, useCallback, useState } from "react";
import { useBookSearch } from "~/hooks/use-book-search";

interface UseReaderSearchOptions {
  bookRef: React.RefObject<import("epubjs/types/book").default | null>;
  renditionRef: React.RefObject<import("epubjs/types/rendition").default | null>;
  bookId: string;
  /** When provided, Cmd/Ctrl+F is only intercepted if this element (or a descendant) has focus. */
  panelRef?: React.RefObject<HTMLElement | null>;
}

interface UseReaderSearchReturn {
  searchOpen: boolean;
  searchQuery: string;
  searchResults: ReturnType<typeof useBookSearch>["results"];
  searchIndex: number;
  searchNext: () => void;
  searchPrev: () => void;
  handleSearchOpen: () => void;
  handleSearchClose: () => void;
  handleSearchQueryChange: (query: string) => void;
  /** Pass this to useEpubLifecycle's onSearchOpen option */
  handleSearchOpenFromIframe: () => void;
}

/**
 * Shared hook that encapsulates search state management, search highlight
 * annotations, and Cmd/Ctrl+F keyboard shortcut interception for epub readers.
 */
export function useReaderSearch({
  bookRef,
  renditionRef,
  bookId,
  panelRef,
}: UseReaderSearchOptions): UseReaderSearchReturn {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const {
    search: executeSearch,
    results: searchResults,
    currentIndex: searchIndex,
    next: searchNext,
    prev: searchPrev,
    clear: clearSearch,
  } = useBookSearch(bookRef);

  // Track previous search annotations so we can remove them
  const prevSearchCfisRef = useRef<string[]>([]);

  // Navigate to current search result when index changes
  useEffect(() => {
    if (searchResults.length > 0 && searchResults[searchIndex]) {
      renditionRef.current?.display(searchResults[searchIndex].cfi).catch((err: unknown) => {
        console.warn("Search navigation failed:", err);
      });
    }
  }, [searchIndex, searchResults, renditionRef]);

  // Apply/remove search highlight annotations in the epub
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;

    // Remove previous annotations
    for (const cfi of prevSearchCfisRef.current) {
      try {
        rendition.annotations.remove(cfi, "highlight");
      } catch {
        // annotation may not exist
      }
    }

    if (searchResults.length === 0) {
      prevSearchCfisRef.current = [];
      return;
    }

    // Add highlight annotations for all results
    const cfis: string[] = [];
    for (let i = 0; i < searchResults.length; i++) {
      const cfi = searchResults[i].cfi;
      cfis.push(cfi);
      const isCurrent = i === searchIndex;
      const className = isCurrent ? "search-hl-current" : "search-hl";
      try {
        rendition.annotations.highlight(cfi, {}, undefined, className, {
          fill: isCurrent ? "rgba(59, 130, 246, 0.6)" : "rgba(59, 130, 246, 0.25)",
          "fill-opacity": "1",
          "mix-blend-mode": "multiply",
        });
      } catch {
        // annotation may fail for invalid CFIs
      }
    }
    prevSearchCfisRef.current = cfis;
  }, [searchResults, searchIndex, renditionRef]);

  // Clear search when book changes
  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery("");
    clearSearch();
  }, [bookId, clearSearch]);

  const handleSearchOpen = useCallback(() => {
    setSearchOpen(true);
  }, []);

  const handleSearchClose = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    clearSearch();
  }, [clearSearch]);

  const handleSearchQueryChange = useCallback(
    (query: string) => {
      setSearchQuery(query);
      executeSearch(query);
    },
    [executeSearch],
  );

  const handleSearchOpenFromIframe = useCallback(() => {
    setSearchOpen(true);
  }, []);

  // Intercept Cmd/Ctrl+F on the parent document
  useEffect(() => {
    const handleFindShortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        // If panelRef is provided, only intercept when focus is inside the panel
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
    return () => {
      document.removeEventListener("keydown", handleFindShortcut);
    };
  }, [panelRef]);

  return {
    searchOpen,
    searchQuery,
    searchResults,
    searchIndex,
    searchNext,
    searchPrev,
    handleSearchOpen,
    handleSearchClose,
    handleSearchQueryChange,
    handleSearchOpenFromIframe,
  };
}
