import type { ReaderLayout } from "~/lib/settings";

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
