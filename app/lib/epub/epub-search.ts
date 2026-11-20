import { openPublication, openZipResourceProvider } from "@readmaxxing/epub-successor";
import {
  createSuccessorBookAdapter,
  type SuccessorBookAdapter,
} from "~/lib/epub/successor-reader-adapter";

export interface SearchResult {
  cfi: string;
  excerpt: string;
  section: string;
}

export interface SearchOptions {
  signal?: AbortSignal;
}

export function normalizeSearchText(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/\u2014/g, "--")
    .replace(/\u2013/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00A0\u202F]/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function searchBookForCfi(
  book: SuccessorBookAdapter,
  query: string,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  await book.ready;

  const spine = book.spine as any;
  if (typeof spine.each !== "function") {
    return [];
  }

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
    } catch {}
  }

  return allResults;
}

export async function fuzzySearchBookForCfi(
  book: SuccessorBookAdapter,
  query: string,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  let results = await searchBookForCfi(book, query, options);
  if (results.length > 0) return results;

  const normalized = normalizeSearchText(query);
  if (normalized !== query) {
    results = await searchBookForCfi(book, normalized, options);
    if (results.length > 0) return results;
  }

  for (const len of [60, 30]) {
    if (normalized.length <= len) continue;
    const short = normalized.slice(0, len).trim();
    if (!short) continue;
    results = await searchBookForCfi(book, short, options);
    if (results.length > 0) return results;
  }

  return [];
}

export async function fuzzySearchEpubForCfi(
  data: ArrayBuffer,
  query: string,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  const provider = await openZipResourceProvider(data, { signal: options?.signal });
  try {
    const opened = await openPublication(provider, { signal: options?.signal });
    if (!opened.publication) return [];
    return await fuzzySearchBookForCfi(
      createSuccessorBookAdapter(opened.publication, provider),
      query,
      options,
    );
  } finally {
    provider.close();
  }
}
