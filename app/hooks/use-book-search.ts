import { useState, useCallback, useRef, useEffect } from "react";
import { searchBookForCfi, type SearchResult } from "~/lib/epub/epub-search";
import type { SuccessorBookAdapter } from "~/lib/epub/successor-reader-adapter";

export type { SearchResult } from "~/lib/epub/epub-search";

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

export function useBookSearch(
  bookRef: React.RefObject<SuccessorBookAdapter | null>,
): UseBookSearchReturn {
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

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const allResults = await searchBookForCfi(book, query, {
          signal: controller.signal,
        });

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
