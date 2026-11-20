import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

export interface PdfSearchResult {
  page: number;
  excerpt: string;
  matchIndex: number;
}

export interface PdfSearchOptions {
  signal?: AbortSignal;
}

const CONTEXT_CHARS = 60;

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

      const pageText = textContent.items
        .filter((item): item is TextItem => "str" in item)
        .map((item) => item.str)
        .join(" ");

      const lowerPageText = pageText.toLowerCase();

      let searchFrom = 0;
      while (true) {
        const idx = lowerPageText.indexOf(lowerQuery, searchFrom);
        if (idx === -1) break;

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
    } catch {}
  }

  return results;
}
