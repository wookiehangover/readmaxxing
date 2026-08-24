import { PdfParseError } from "~/lib/errors";

export interface PdfMetadata {
  title: string;
  author: string;
  pageCount: number;
  coverImage: Blob | null;
}

// --- Worker setup ---

let workerConfigured = false;

async function ensurePdfWorker() {
  if (workerConfigured) return;
  const pdfjs = await import("pdfjs-dist");
  // Use the bundled worker via Vite's URL import for proper asset handling
  const workerUrl = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.href;
  workerConfigured = true;
}

export async function parsePdf(data: ArrayBuffer, fileName?: string): Promise<PdfMetadata> {
  try {
    await ensurePdfWorker();
    const pdfjs = await import("pdfjs-dist");
    // Copy the data so pdfjs doesn't detach the caller's ArrayBuffer
    const dataCopy = new Uint8Array(data).slice();
    const loadingTask = pdfjs.getDocument({ data: dataCopy });
    const doc = await loadingTask.promise;

    try {
      const metadata = await doc.getMetadata();
      const info = metadata?.info as Record<string, unknown> | undefined;

      // Extract title: prefer PDF metadata, fall back to filename
      let title = "Untitled";
      if (info?.Title && typeof info.Title === "string" && info.Title.trim()) {
        title = info.Title.trim();
      } else if (fileName) {
        title = fileName.replace(/\.pdf$/i, "");
      }

      // Extract author
      let author = "Unknown Author";
      if (info?.Author && typeof info.Author === "string" && info.Author.trim()) {
        author = info.Author.trim();
      }

      const pageCount = doc.numPages;

      // Generate cover thumbnail from first page
      let coverImage: Blob | null = null;
      try {
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        // Scale to a reasonable thumbnail size (max 400px wide)
        const scale = Math.min(400 / viewport.width, 1.5);
        const scaledViewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        canvas.width = scaledViewport.width;
        canvas.height = scaledViewport.height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          await page.render({ canvas, canvasContext: ctx, viewport: scaledViewport }).promise;
          coverImage = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob((blob) => resolve(blob), "image/png"),
          );
        }
        page.cleanup();
      } catch {
        // Cover extraction is non-fatal
      }

      return {
        title,
        author,
        pageCount,
        coverImage,
      } satisfies PdfMetadata;
    } finally {
      await loadingTask.destroy().catch(() => {});
    }
  } catch (cause) {
    throw new PdfParseError({ operation: "parsePdf", cause });
  }
}
