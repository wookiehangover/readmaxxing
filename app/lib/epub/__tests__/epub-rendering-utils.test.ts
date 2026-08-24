import { describe, it, expect } from "vitest";
import {
  getFontFallback,
  getTypographyCss,
  getRenditionOptions,
} from "~/lib/epub/epub-rendering-utils";

describe("getFontFallback", () => {
  it("returns sans-serif for Geist", () => {
    expect(getFontFallback("Geist")).toBe("sans-serif");
  });

  it("returns monospace for Geist Mono", () => {
    expect(getFontFallback("Geist Mono")).toBe("monospace");
  });

  it("returns monospace for Berkeley Mono", () => {
    expect(getFontFallback("Berkeley Mono")).toBe("monospace");
  });

  it("returns sans-serif for Inter", () => {
    expect(getFontFallback("Inter")).toBe("sans-serif");
  });

  it("returns serif for serif fonts", () => {
    expect(getFontFallback("Literata")).toBe("serif");
    expect(getFontFallback("Lora")).toBe("serif");
    expect(getFontFallback("Merriweather")).toBe("serif");
    expect(getFontFallback("Source Serif 4")).toBe("serif");
  });
});

describe("getTypographyCss", () => {
  it("includes font-family with fallback", () => {
    const css = getTypographyCss("Literata", 100, 400, 1.6, undefined);
    expect(css).toContain('"Literata", serif !important');
  });

  it("includes font-size percentage", () => {
    const css = getTypographyCss("Literata", 120, 400, 1.6, undefined);
    expect(css).toContain("font-size: 120% !important");
  });

  it("includes line-height", () => {
    const css = getTypographyCss("Literata", 100, 400, 1.8, undefined);
    expect(css).toContain("line-height: 1.8 !important");
  });

  it("includes text-align when specified", () => {
    const css = getTypographyCss("Literata", 100, 400, 1.6, "justify");
    expect(css).toContain("text-align: justify !important");
  });

  it("does not include text-align when undefined (default)", () => {
    const css = getTypographyCss("Literata", 100, 400, 1.6, undefined);
    expect(css).not.toContain("text-align:");
  });

  it("applies font weight through body inheritance so heading rules remain relative", () => {
    const css = getTypographyCss("Literata", 100, 600, 1.6, undefined);
    expect(css).toContain("body {\n      font-weight: 600 !important;");
  });

  it("includes absolute-origin @font-face declarations for every reader font", () => {
    const css = getTypographyCss("Literata", 100, 400, 1.6, undefined);
    const fontFiles = [
      "Geist[wght].woff2",
      "GeistMono[wght].woff2",
      "BerkeleyMonoVariable.woff2",
      "Inter[opsz,wght].woff2",
      "Literata[opsz,wght].woff2",
      "Lora[wght].woff2",
      "Merriweather[opsz,wdth,wght].woff2",
      "SourceSerif4[opsz,wght].woff2",
    ];

    expect(css.match(/@font-face/g)).toHaveLength(fontFiles.length);
    for (const file of fontFiles) {
      expect(css).toContain(`url("${window.location.origin}/fonts/${file}")`);
    }
    expect(css).not.toContain("fonts.googleapis.com");
    expect(css).not.toContain("fonts.gstatic.com");
  });

  it("uses correct fallback for monospace fonts", () => {
    const css = getTypographyCss("Geist Mono", 100, 400, 1.6, undefined);
    expect(css).toContain('"Geist Mono", monospace !important');
  });
});

describe("getRenditionOptions", () => {
  it("returns paginated spread options for spread layout", () => {
    const opts = getRenditionOptions("spread");
    expect(opts).toEqual({ spread: "always", flow: "paginated", gap: 64 });
  });

  it("returns scrolled-doc options for scroll layout", () => {
    const opts = getRenditionOptions("scroll");
    expect(opts).toEqual({ spread: "none", flow: "scrolled-doc" });
  });

  it("returns single-page paginated options for single layout", () => {
    const opts = getRenditionOptions("single");
    expect(opts).toEqual({ spread: "none", flow: "paginated" });
  });
});
