import { useEffect, useRef, useCallback, useState } from "react";
import { useBookSearch } from "~/hooks/use-book-search";
import type {
  SuccessorBookAdapter,
  SuccessorRenditionAdapter,
} from "~/lib/epub/successor-reader-adapter";

interface UseReaderSearchOptions {
  bookRef: React.RefObject<SuccessorBookAdapter | null>;
  renditionRef: React.RefObject<SuccessorRenditionAdapter | null>;
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

  // Track previous search decorations so we can remove them
  const prevSearchDecorationIdsRef = useRef<string[]>([]);

  // Navigate to current search result when index changes
  useEffect(() => {
    if (searchResults.length > 0 && searchResults[searchIndex]) {
      renditionRef.current?.display(searchResults[searchIndex].cfi).catch((err: unknown) => {
        console.warn("Search navigation failed:", err);
      });
    }
  }, [searchIndex, searchResults, renditionRef]);

  // Apply/remove search highlight decorations in the epub
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;

    for (const id of prevSearchDecorationIdsRef.current) rendition.removeDecoration(id);

    if (searchResults.length === 0) {
      prevSearchDecorationIdsRef.current = [];
      return;
    }

    // Add highlight decorations for all results
    const decorationIds: string[] = [];
    for (let i = 0; i < searchResults.length; i++) {
      const cfi = searchResults[i].cfi;
      const isCurrent = i === searchIndex;
      const locator = rendition.locatorFromCfi(cfi);
      if (!locator) continue;
      const id = `search-highlight-${i}`;
      decorationIds.push(id);
      rendition.upsertDecoration({
        id,
        locator,
        style: {
          variant: "highlight",
          color: isCurrent ? "rgba(59, 130, 246, 0.6)" : "rgba(59, 130, 246, 0.25)",
        },
      });
    }
    prevSearchDecorationIdsRef.current = decorationIds;
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
