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
  handleSearchOpenFromIframe: () => void;
}

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

  const prevSearchDecorationIdsRef = useRef<string[]>([]);

  useEffect(() => {
    if (searchResults.length > 0 && searchResults[searchIndex]) {
      renditionRef.current?.display(searchResults[searchIndex].cfi).catch((err: unknown) => {
        console.warn("Search navigation failed:", err);
      });
    }
  }, [searchIndex, searchResults, renditionRef]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;

    for (const id of prevSearchDecorationIdsRef.current) rendition.removeDecoration(id);

    if (searchResults.length === 0) {
      prevSearchDecorationIdsRef.current = [];
      return;
    }

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
