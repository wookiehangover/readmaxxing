import type { ReaderLayout } from "~/lib/settings";
import type Rendition from "epubjs/types/rendition";

/**
 * CSS to prevent oversized images from breaking epubjs pagination.
 * Standard Ebooks titlepages use a full-width PNG that overflows the
 * viewport, causing epubjs to create phantom blank pages.
 */
export const EPUB_IMAGE_CONTAINMENT_CSS = `
  /* Prevent oversized images from breaking epubjs pagination */
  img {
    max-height: 95vh;
    max-width: 100%;
    object-fit: contain;
  }
  /* Fix SE titlepage layout for epubjs pagination */
  section[class*="titlepage"] img {
    max-height: 80vh;
  }
`;

export function getFontFallback(fontFamily: string): string {
  if (fontFamily === "Geist") return "sans-serif";
  if (fontFamily === "Geist Mono") return "monospace";
  if (fontFamily === "Berkeley Mono") return "monospace";
  return "serif";
}

export function getTypographyCss(fontFamily: string, fontSize: number, lineHeight: number): string {
  const fallback = getFontFallback(fontFamily);
  return `
    @font-face {
      font-family: "Geist";
      src: url("/fonts/Geist[wght].woff2") format("woff2");
      font-weight: 100 900;
      font-display: swap;
    }
    @font-face {
      font-family: "Geist Mono";
      src: url("/fonts/GeistMono[wght].woff2") format("woff2");
      font-weight: 100 900;
      font-display: swap;
    }
    @font-face {
      font-family: "Berkeley Mono";
      src: url("/fonts/BerkeleyMonoVariable.woff2") format("woff2");
      font-weight: 100 900;
      font-display: swap;
    }
    * {
      font-family: "${fontFamily}", ${fallback} !important;
      font-size: ${fontSize}% !important;
      line-height: ${lineHeight} !important;
    }
  `;
}

export function getRenditionOptions(layout: ReaderLayout) {
  switch (layout) {
    case "spread":
      return { spread: "always" as const, flow: "paginated" as const, gap: 64 };
    case "scroll":
      return { spread: "none" as const, flow: "scrolled-doc" as const };
    case "single":
    default:
      return { spread: "none" as const, flow: "paginated" as const };
  }
}

/**
 * Detect blank overflow pages by sampling the iframe viewport with
 * `document.elementFromPoint()`. If all sample points hit only body/html/section,
 * the page is blank. This works correctly in paginated mode where epubjs returns
 * the same document for all pages within a spine item.
 */
export function isBlankPage(rendition: Rendition): boolean {
  const contents = (rendition as any).getContents?.() as any[];
  if (!contents || contents.length === 0) return false;

  const content = contents[0];
  const doc = content?.document as Document | undefined;
  const win = content?.window as Window | undefined;
  if (!doc || !win) return false;

  const w = win.innerWidth;
  const h = win.innerHeight;
  if (w === 0 || h === 0) return false;

  const samplePoints: [number, number][] = [
    [w * 0.5, h * 0.5],
    [w * 0.25, h * 0.25],
    [w * 0.75, h * 0.75],
    [w * 0.5, h * 0.25],
    [w * 0.5, h * 0.75],
  ];

  for (const [x, y] of samplePoints) {
    const el = doc.elementFromPoint(x, y);
    if (el && el.tagName !== "HTML" && el.tagName !== "BODY" && el.tagName !== "SECTION") {
      return false;
    }
  }

  return true;
}
