import type { TextItem } from "pdfjs-dist/types/src/display/api";
import type { BookChapter } from "~/lib/epub-text-extract";

/**
 * Configure the pdfjs worker. Reuses the same pattern as pdf-service.ts.
 */
let workerConfigured = false;

async function ensurePdfWorker() {
  if (workerConfigured) return;
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.href;
  workerConfigured = true;
}

/**
 * Extract structured page-based text from a PDF ArrayBuffer.
 * Each page becomes a "chapter" with title "Page N".
 * Client-side only — pdfjs requires browser APIs.
 *
 * @param data - The PDF file as an ArrayBuffer
 * @returns Array of chapters (one per page) with index, title, and text
 */
export async function extractPdfChapters(data: ArrayBuffer): Promise<BookChapter[]> {
  await ensurePdfWorker();
  const pdfjs = await import("pdfjs-dist");

  // Clone data so pdfjs doesn't detach the caller's ArrayBuffer
  const dataCopy = new Uint8Array(data).slice();
  const loadingTask = pdfjs.getDocument({ data: dataCopy });
  const doc = await loadingTask.promise;

  try {
    const chapters: BookChapter[] = [];

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      try {
        const page = await doc.getPage(pageNum);
        const textContent = await page.getTextContent();

        const text = textContent.items
          .filter((item): item is TextItem => "str" in item)
          .map((item) => item.str)
          .join(" ")
          .trim();

        page.cleanup();

        if (!text) continue;

        chapters.push({
          index: pageNum - 1,
          title: `Page ${pageNum}`,
          text,
        });
      } catch (err) {
        console.warn(`Failed to extract text from PDF page ${pageNum}:`, err);
        continue;
      }
    }

    return chapters;
  } finally {
    await doc.destroy();
  }
}

/**
 * Extract text from a single PDF page.
 * Useful for getting the currently visible page text for chat context.
 *
 * @param data - The PDF file as an ArrayBuffer
 * @param pageNum - 1-based page number
 * @returns The text content of the page, or empty string on failure
 */
export async function extractPdfPageText(data: ArrayBuffer, pageNum: number): Promise<string> {
  await ensurePdfWorker();
  const pdfjs = await import("pdfjs-dist");

  const dataCopy = new Uint8Array(data).slice();
  const loadingTask = pdfjs.getDocument({ data: dataCopy });
  const doc = await loadingTask.promise;

  try {
    if (pageNum < 1 || pageNum > doc.numPages) return "";

    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();

    const text = textContent.items
      .filter((item): item is TextItem => "str" in item)
      .map((item) => item.str)
      .join(" ")
      .trim();

    page.cleanup();
    return text;
  } catch {
    return "";
  } finally {
    await doc.destroy();
  }
}

/**
 * Extract text from a single page of an already-loaded pdfjs document.
 * Avoids re-creating the document on every page navigation.
 *
 * @param doc - An already-loaded pdfjs PDFDocumentProxy
 * @param pageNum - 1-based page number
 * @returns The text content of the page, or empty string on failure
 */
export async function extractPdfPageTextFromDoc(doc: any, pageNum: number): Promise<string> {
  try {
    if (pageNum < 1 || pageNum > doc.numPages) return "";

    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();

    const text = textContent.items
      .filter((item: any): item is TextItem => "str" in item)
      .map((item: any) => item.str)
      .join(" ")
      .trim();

    page.cleanup();
    return text;
  } catch {
    return "";
  }
}
