import type EpubBook from "epubjs/types/book";

export interface SearchResult {
  cfi: string;
  excerpt: string;
  section: string;
}

export interface SearchOptions {
  /** Optional abort signal to cancel the search early */
  signal?: AbortSignal;
}

/**
 * Normalize text for epub search — handles smart quotes, em/en dashes,
 * ellipsis characters, and excessive whitespace that AI models often produce
 * but epub source text may not contain (or vice versa).
 */
export function normalizeSearchText(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A]/g, "'") // smart single quotes → straight
    .replace(/[\u201C\u201D\u201E]/g, '"') // smart double quotes → straight
    .replace(/\u2014/g, "--") // em dash → double hyphen
    .replace(/\u2013/g, "-") // en dash → hyphen
    .replace(/\u2026/g, "...") // ellipsis char → three dots
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();
}

/**
 * Search an epubjs Book instance for a query string across all spine items.
 * Returns an array of results with CFI locations, excerpts, and section labels.
 *
 * This is a standalone, testable utility extracted from the useBookSearch hook.
 */
export async function searchBookForCfi(
  book: EpubBook,
  query: string,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  await book.ready;

  const spine = book.spine as any;
  if (typeof spine.each !== "function") {
    return [];
  }

  // Collect all spine items
  const spineItems: any[] = [];
  spine.each((item: any) => {
    spineItems.push(item);
  });

  const allResults: SearchResult[] = [];

  for (const item of spineItems) {
    if (options?.signal?.aborted) return allResults;

    try {
      await item.load(book.load.bind(book));
      const sectionResults: { cfi: string; excerpt: string }[] = await item.find(query);

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

  return allResults;
}

/**
 * Search with progressive fallback: tries the full query first, then
 * normalized text, then progressively shorter prefixes.
 * Designed for AI-generated text that may not match epub source exactly.
 */
export async function fuzzySearchBookForCfi(
  book: EpubBook,
  query: string,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  // 1. Try exact query
  let results = await searchBookForCfi(book, query, options);
  if (results.length > 0) return results;

  // 2. Try normalized text
  const normalized = normalizeSearchText(query);
  if (normalized !== query) {
    results = await searchBookForCfi(book, normalized, options);
    if (results.length > 0) return results;
  }

  // 3. Try shorter prefixes (first 60 chars, then 30)
  for (const len of [60, 30]) {
    if (normalized.length <= len) continue;
    const short = normalized.slice(0, len).trim();
    if (!short) continue;
    results = await searchBookForCfi(book, short, options);
    if (results.length > 0) return results;
  }

  return [];
}
