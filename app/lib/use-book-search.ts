import { useState, useCallback, useRef, useEffect } from "react";
import type EpubBook from "epubjs/types/book";
import { searchBookForCfi, type SearchResult } from "~/lib/epub-search";

export type { SearchResult } from "~/lib/epub-search";

interface UseBookSearchReturn {
  search: (query: string) => void;
  results: SearchResult[];
  currentIndex: number;
  next: () => void;
  prev: () => void;
  clear: () => void;
  isSearching: boolean;
}

const DEBOUNCE_MS = 300;

/**
 * Hook that encapsulates epub full-text search across all spine items.
 * Accepts a ref to an epubjs Book instance.
 *
 * Usage:
 * ```ts
 * const { search, results, currentIndex, next, prev, clear } = useBookSearch(bookRef);
 * ```
 */
export function useBookSearch(bookRef: React.RefObject<EpubBook | null>): UseBookSearchReturn {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchIdRef = useRef(0);

  const clear = useCallback(() => {
    setResults([]);
    setCurrentIndex(0);
    setIsSearching(false);
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  }, []);

  const abortRef = useRef<AbortController | null>(null);

  const executeSearch = useCallback(
    async (query: string, searchId: number) => {
      const book = bookRef.current;
      if (!book) {
        setIsSearching(false);
        return;
      }

      // Abort any previous in-flight search
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const allResults = await searchBookForCfi(book, query, {
          signal: controller.signal,
        });

        // Only update state if this is still the latest search
        if (searchIdRef.current === searchId) {
          setResults(allResults);
          setCurrentIndex(0);
          setIsSearching(false);
        }
      } catch {
        if (searchIdRef.current === searchId) {
          setResults([]);
          setCurrentIndex(0);
          setIsSearching(false);
        }
      }
    },
    [bookRef],
  );

  const search = useCallback(
    (query: string) => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }

      const trimmed = query.trim();
      if (!trimmed) {
        clear();
        return;
      }

      setIsSearching(true);
      const searchId = ++searchIdRef.current;

      debounceTimer.current = setTimeout(() => {
        executeSearch(trimmed, searchId);
      }, DEBOUNCE_MS);
    },
    [executeSearch, clear],
  );

  const next = useCallback(() => {
    setCurrentIndex((prev) => (results.length === 0 ? 0 : (prev + 1) % results.length));
  }, [results.length]);

  const prev = useCallback(() => {
    setCurrentIndex((prev) =>
      results.length === 0 ? 0 : (prev - 1 + results.length) % results.length,
    );
  }, [results.length]);

  // Cleanup debounce timer and abort in-flight search on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      abortRef.current?.abort();
    };
  }, []);

  return { search, results, currentIndex, next, prev, clear, isSearching };
}
