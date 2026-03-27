import { useState, useCallback, useRef, useEffect } from "react";
import type EpubBook from "epubjs/types/book";

export interface SearchResult {
  cfi: string;
  excerpt: string;
  section: string;
}

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
export function useBookSearch(
  bookRef: React.RefObject<EpubBook | null>,
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

  const executeSearch = useCallback(
    async (query: string, searchId: number) => {
      const book = bookRef.current;
      if (!book) {
        setIsSearching(false);
        return;
      }

      try {
        await book.ready;

        // Ensure spine is loaded
        const spine = book.spine as any;
        if (typeof spine.each !== "function") {
          setIsSearching(false);
          return;
        }

        // Collect all spine items
        const spineItems: any[] = [];
        spine.each((item: any) => {
          spineItems.push(item);
        });

        const allResults: SearchResult[] = [];

        for (const item of spineItems) {
          // Abort if a newer search has been triggered
          if (searchIdRef.current !== searchId) return;

          try {
            await item.load(book.load.bind(book));
            const sectionResults: { cfi: string; excerpt: string }[] =
              await item.find(query);

            for (const result of sectionResults) {
              allResults.push({
                cfi: result.cfi,
                excerpt: result.excerpt,
                section: item.label || item.href || "",
              });
            }

            item.unload();
          } catch {
            // Individual section search failures are non-fatal
          }
        }

        // Only update state if this is still the latest search
        if (searchIdRef.current === searchId) {
          setResults(allResults);
          setCurrentIndex(allResults.length > 0 ? 0 : 0);
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
    setCurrentIndex((prev) =>
      results.length === 0 ? 0 : (prev + 1) % results.length,
    );
  }, [results.length]);

  const prev = useCallback(() => {
    setCurrentIndex((prev) =>
      results.length === 0
        ? 0
        : (prev - 1 + results.length) % results.length,
    );
  }, [results.length]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  return { search, results, currentIndex, next, prev, clear, isSearching };
}
