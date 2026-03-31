import { useEffect, useRef, useCallback, useState } from "react";
import { searchPdf, type PdfSearchResult } from "~/lib/pdf-search";
import type { PDFDocumentProxy } from "pdfjs-dist";

const DEBOUNCE_MS = 300;

interface UsePdfSearchOptions {
  pdfDocRef: React.RefObject<PDFDocumentProxy | null>;
  bookId: string;
  /** Navigate to the given page number (1-based) */
  goToPage: (page: number) => void;
  /** When provided, Cmd/Ctrl+F is only intercepted if this element (or a descendant) has focus. */
  panelRef?: React.RefObject<HTMLElement | null>;
}

interface UsePdfSearchReturn {
  searchOpen: boolean;
  searchQuery: string;
  searchResults: PdfSearchResult[];
  searchIndex: number;
  searchNext: () => void;
  searchPrev: () => void;
  handleSearchOpen: () => void;
  handleSearchClose: () => void;
  handleSearchQueryChange: (query: string) => void;
}

/**
 * Hook that encapsulates PDF full-text search state management,
 * text layer highlighting, and Cmd/Ctrl+F keyboard shortcut interception.
 */
export function usePdfSearch({
  pdfDocRef,
  bookId,
  goToPage,
  panelRef,
}: UsePdfSearchOptions): UsePdfSearchReturn {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PdfSearchResult[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const clear = useCallback(() => {
    setSearchResults([]);
    setSearchIndex(0);
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    abortRef.current?.abort();
    clearHighlights();
  }, []);

  const executeSearch = useCallback(
    async (query: string, searchId: number) => {
      const doc = pdfDocRef.current;
      if (!doc) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const results = await searchPdf(doc, query, { signal: controller.signal });
        if (searchIdRef.current === searchId) {
          setSearchResults(results);
          setSearchIndex(0);
        }
      } catch {
        if (searchIdRef.current === searchId) {
          setSearchResults([]);
          setSearchIndex(0);
        }
      }
    },
    [pdfDocRef],
  );

  const handleSearchQueryChange = useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      const trimmed = query.trim();
      if (!trimmed) {
        clear();
        return;
      }
      const searchId = ++searchIdRef.current;
      debounceTimer.current = setTimeout(() => {
        executeSearch(trimmed, searchId);
      }, DEBOUNCE_MS);
    },
    [executeSearch, clear],
  );

  // Navigate to the page of the current result
  useEffect(() => {
    if (searchResults.length > 0 && searchResults[searchIndex]) {
      goToPage(searchResults[searchIndex].page);
    }
  }, [searchIndex, searchResults, goToPage]);

  // Apply highlights in text layer when results or index change
  useEffect(() => {
    applyHighlights(searchQuery, searchResults, searchIndex);
    // We need a slight delay because goToPage may re-render the text layer
    const timer = setTimeout(() => {
      applyHighlights(searchQuery, searchResults, searchIndex);
    }, 200);
    return () => clearTimeout(timer);
  }, [searchResults, searchIndex, searchQuery]);

  // Clear search when book changes
  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery("");
    clear();
  }, [bookId, clear]);

  const searchNext = useCallback(() => {
    setSearchIndex((prev) => (searchResults.length === 0 ? 0 : (prev + 1) % searchResults.length));
  }, [searchResults.length]);

  const searchPrev = useCallback(() => {
    setSearchIndex((prev) =>
      searchResults.length === 0 ? 0 : (prev - 1 + searchResults.length) % searchResults.length,
    );
  }, [searchResults.length]);

  const handleSearchOpen = useCallback(() => setSearchOpen(true), []);

  const handleSearchClose = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    clear();
  }, [clear]);

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      abortRef.current?.abort();
      clearHighlights();
    };
  }, []);

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
  };
}

/** CSS class for search highlight marks injected into the text layer */
const SEARCH_HL_CLASS = "pdf-search-highlight";
const SEARCH_HL_CURRENT_CLASS = "pdf-search-highlight-current";

/**
 * Remove all search highlight marks from all text layers in the document.
 */
function clearHighlights() {
  const marks = document.querySelectorAll(`.${SEARCH_HL_CLASS}, .${SEARCH_HL_CURRENT_CLASS}`);
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
      parent.normalize();
    }
  }
}

/**
 * Highlight matching text in pdf text layer spans.
 * Finds all `.pdf-text-layer span` elements and wraps matching text in <mark> tags.
 */
function applyHighlights(query: string, results: PdfSearchResult[], currentIndex: number) {
  clearHighlights();
  if (!query.trim() || results.length === 0) return;

  const currentResult = results[currentIndex];
  const lowerQuery = query.trim().toLowerCase();
  const queryLen = query.trim().length;

  // Build a set of (page, matchIndexWithinPage) for the current result
  // so we can distinguish it visually.
  let currentPageMatchIdx = -1;
  if (currentResult) {
    const samePageBefore = results
      .slice(0, currentIndex)
      .filter((r) => r.page === currentResult.page);
    currentPageMatchIdx = samePageBefore.length;
  }

  const pageWrappers = document.querySelectorAll<HTMLElement>(".pdf-page-wrapper");

  for (const wrapper of pageWrappers) {
    const pageNum = parseInt(wrapper.dataset.pageNumber || "0", 10);
    const textLayer = wrapper.querySelector<HTMLElement>(".pdf-text-layer");
    if (!textLayer) continue;

    // Track match index within the page for current-highlight detection
    let pageMatchCount = 0;

    const spans = textLayer.querySelectorAll("span");
    for (const span of spans) {
      const text = span.textContent || "";
      const lowerText = text.toLowerCase();

      let searchFrom = 0;
      let lastEnd = 0;
      const parts: { text: string; isMatch: boolean; isCurrent: boolean }[] = [];

      while (true) {
        const idx = lowerText.indexOf(lowerQuery, searchFrom);
        if (idx === -1) break;

        if (idx > lastEnd) {
          parts.push({ text: text.slice(lastEnd, idx), isMatch: false, isCurrent: false });
        }

        const isCurrentMatch =
          currentResult !== undefined &&
          pageNum === currentResult.page &&
          pageMatchCount === currentPageMatchIdx;

        parts.push({
          text: text.slice(idx, idx + queryLen),
          isMatch: true,
          isCurrent: isCurrentMatch,
        });

        lastEnd = idx + queryLen;
        searchFrom = idx + 1;
        pageMatchCount++;
      }

      if (parts.length > 0) {
        if (lastEnd < text.length) {
          parts.push({ text: text.slice(lastEnd), isMatch: false, isCurrent: false });
        }

        span.textContent = "";
        for (const part of parts) {
          if (!part.isMatch) {
            span.appendChild(document.createTextNode(part.text));
          } else {
            const mark = document.createElement("mark");
            mark.className = part.isCurrent ? SEARCH_HL_CURRENT_CLASS : SEARCH_HL_CLASS;
            mark.textContent = part.text;
            span.appendChild(mark);
          }
        }
      }
    }
  }
}
