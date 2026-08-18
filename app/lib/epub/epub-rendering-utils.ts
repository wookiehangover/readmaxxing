import type { FontWeight, ReaderLayout, TextAlign } from "~/lib/settings";

export function getFontFallback(fontFamily: string): string {
  if (fontFamily === "Geist" || fontFamily === "Inter") return "sans-serif";
  if (fontFamily === "Geist Mono") return "monospace";
  if (fontFamily === "Berkeley Mono") return "monospace";
  return "serif";
}

export function getTypographyCss(
  fontFamily: string,
  fontSize: number,
  fontWeight: FontWeight,
  lineHeight: number,
  textAlign: TextAlign,
): string {
  const fallback = getFontFallback(fontFamily);
  const fontOrigin = typeof window === "undefined" ? undefined : window.location.origin;
  const fontFaces = fontOrigin
    ? `
    @font-face {
      font-family: "Geist";
      src: url("${fontOrigin}/fonts/Geist[wght].woff2") format("woff2");
      font-weight: 100 900;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: "Geist Mono";
      src: url("${fontOrigin}/fonts/GeistMono[wght].woff2") format("woff2");
      font-weight: 100 900;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: "Berkeley Mono";
      src: url("${fontOrigin}/fonts/BerkeleyMonoVariable.woff2") format("woff2");
      font-weight: 100 900;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: "Inter";
      src: url("${fontOrigin}/fonts/Inter[opsz,wght].woff2") format("woff2");
      font-weight: 100 900;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: "Literata";
      src: url("${fontOrigin}/fonts/Literata[opsz,wght].woff2") format("woff2");
      font-weight: 200 900;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: "Lora";
      src: url("${fontOrigin}/fonts/Lora[wght].woff2") format("woff2");
      font-weight: 400 700;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: "Merriweather";
      src: url("${fontOrigin}/fonts/Merriweather[opsz,wdth,wght].woff2") format("woff2");
      font-weight: 300 900;
      font-stretch: 87% 112%;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: "Source Serif 4";
      src: url("${fontOrigin}/fonts/SourceSerif4[opsz,wght].woff2") format("woff2");
      font-weight: 200 900;
      font-style: normal;
      font-display: swap;
    }`
    : "";
  const textAlignCss = textAlign
    ? `
    p, div, span, li, td, th, blockquote, pre {
      text-align: ${textAlign} !important;
    }`
    : "";

  return `${fontFaces}
    * {
      font-family: "${fontFamily}", ${fallback} !important;
      font-size: ${fontSize}% !important;
      line-height: ${lineHeight} !important;
    }
    body {
      font-weight: ${fontWeight} !important;
    }${textAlignCss}
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
