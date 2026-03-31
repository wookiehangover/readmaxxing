import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

export interface PdfSearchResult {
  /** Page number (1-based) */
  page: number;
  /** Text excerpt around the match */
  excerpt: string;
  /** Character index of match start within the page's full text */
  matchIndex: number;
}

export interface PdfSearchOptions {
  /** Optional abort signal to cancel the search early */
  signal?: AbortSignal;
}

const CONTEXT_CHARS = 60;

/**
 * Search a PDF document for a query string across all pages.
 * Uses pdfjs getTextContent() to extract text from each page,
 * then performs case-insensitive substring matching.
 *
 * Returns an array of results with page numbers and excerpts.
 */
export async function searchPdf(
  doc: PDFDocumentProxy,
  query: string,
  options?: PdfSearchOptions,
): Promise<PdfSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const lowerQuery = trimmed.toLowerCase();
  const results: PdfSearchResult[] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    if (options?.signal?.aborted) return results;

    try {
      const page = await doc.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Concatenate all text items on the page
      const pageText = textContent.items
        .filter((item): item is TextItem => "str" in item)
        .map((item) => item.str)
        .join(" ");

      const lowerPageText = pageText.toLowerCase();

      // Find all occurrences on this page
      let searchFrom = 0;
      while (true) {
        const idx = lowerPageText.indexOf(lowerQuery, searchFrom);
        if (idx === -1) break;

        // Build an excerpt with surrounding context
        const start = Math.max(0, idx - CONTEXT_CHARS);
        const end = Math.min(pageText.length, idx + trimmed.length + CONTEXT_CHARS);
        const excerpt =
          (start > 0 ? "…" : "") +
          pageText.slice(start, end).trim() +
          (end < pageText.length ? "…" : "");

        results.push({
          page: pageNum,
          excerpt,
          matchIndex: idx,
        });

        searchFrom = idx + 1;
      }

      page.cleanup();
    } catch {
      // Individual page failures are non-fatal
    }
  }

  return results;
}
