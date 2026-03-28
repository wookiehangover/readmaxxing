import { describe, it, expect } from "vitest";
import { getFontFallback, getTypographyCss, getRenditionOptions } from "~/lib/epub-rendering-utils";

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

  it("returns serif for any other font", () => {
    expect(getFontFallback("Literata")).toBe("serif");
    expect(getFontFallback("Inter")).toBe("serif");
    expect(getFontFallback("Merriweather")).toBe("serif");
  });
});

describe("getTypographyCss", () => {
  it("includes font-family with fallback", () => {
    const css = getTypographyCss("Literata", 100, 1.6);
    expect(css).toContain('"Literata", serif !important');
  });

  it("includes font-size percentage", () => {
    const css = getTypographyCss("Literata", 120, 1.6);
    expect(css).toContain("font-size: 120% !important");
  });

  it("includes line-height", () => {
    const css = getTypographyCss("Literata", 100, 1.8);
    expect(css).toContain("line-height: 1.8 !important");
  });

  it("includes @font-face declarations for Geist, Geist Mono, and Berkeley Mono", () => {
    const css = getTypographyCss("Literata", 100, 1.6);
    expect(css).toContain("@font-face");
    expect(css).toContain('"Geist"');
    expect(css).toContain('"Geist Mono"');
    expect(css).toContain('"Berkeley Mono"');
  });

  it("uses correct fallback for monospace fonts", () => {
    const css = getTypographyCss("Geist Mono", 100, 1.6);
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
