/**
 * Shared utilities for epub theme color resolution.
 *
 * CSS variables in this project use oklch() color format, which may not be
 * supported inside the epub iframe context. This module resolves theme colors
 * to rgb() strings by letting the browser compute the final value.
 */

/**
 * Resolve the `--background` and `--foreground` CSS variable values for the
 * given color mode, returning browser-computed rgb strings that are safe to
 * inject into an epub iframe.
 *
 * A temporary DOM element is used so that `getComputedStyle` returns the
 * resolved rgb value rather than the raw oklch() variable value.
 */
export function resolveThemeColors(mode: "light" | "dark") {
  const root = document.documentElement;
  const currentlyDark = root.classList.contains("dark");
  const needsDark = mode === "dark";

  // Temporarily toggle dark class if necessary so CSS variables resolve
  if (needsDark !== currentlyDark) {
    root.classList.toggle("dark", needsDark);
  }

  // Create a temporary element that uses the CSS variables as actual color
  // properties. getComputedStyle on these properties returns the browser-
  // resolved rgb() value, even when the variable is defined in oklch().
  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.backgroundColor = "var(--background)";
  probe.style.color = "var(--foreground)";
  document.body.appendChild(probe);

  // Force style recalculation before reading computed values
  void probe.offsetHeight;

  const computed = getComputedStyle(probe);
  const background = computed.backgroundColor;
  const foreground = computed.color;

  document.body.removeChild(probe);

  // Restore original dark class state
  if (needsDark !== currentlyDark) {
    root.classList.toggle("dark", currentlyDark);
  }

  return { background, foreground };
}

/**
 * Broad list of selectors that may carry explicit color values in epub content
 * (e.g. Google Docs exports set `color: #000000` on spans/paragraphs).
 * We force them to inherit so our body-level theme color wins.
 */
const COLOR_INHERIT_SELECTORS =
  "p, span, div, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, figcaption, cite, em, strong, b, i, u, small, sub, sup, dd, dt, label";

const IMG_CONTAINMENT_CSS = `img {
  max-height: 95vh !important;
  max-width: 100% !important;
  object-fit: contain !important;
}`;

/**
 * Generate a CSS string for the given theme mode that sets root + body colors
 * and forces color inheritance on common text elements.  This is meant to be
 * injected directly into the epub iframe as a `<style>` element.
 *
 * Both `html` and `body` must share the same background: the navigator also
 * paints hard-coded theme colors on `html`, and multi-column pagination can
 * reveal the root behind/beside columns — a mismatch looks like subsequent
 * pages having a slightly different dark background.
 */
export function getThemeColorCss(mode: "light" | "dark"): string {
  const { background, foreground } = resolveThemeColors(mode);
  return `
html, body {
  color: ${foreground} !important;
  background: ${background} !important;
  background-color: ${background} !important;
}
a { color: inherit !important; }
${COLOR_INHERIT_SELECTORS} {
  color: inherit !important;
}
${IMG_CONTAINMENT_CSS}
`;
}

/**
 * Inject (or update) a `<style id="reader-theme-colors">` element directly
 * into every currently-loaded epub iframe document.  This is the primary
 * mechanism for applying theme colors.
 */
export function injectThemeColors(
  rendition: { getContents?: () => readonly { document?: Document }[] },
  mode: "light" | "dark",
) {
  const css = getThemeColorCss(mode);
  const contents = rendition.getContents?.();
  if (!contents) return;
  for (const content of contents) {
    const doc: Document | undefined = content?.document;
    if (!doc) continue;
    let style = doc.getElementById("reader-theme-colors");
    if (!style) {
      style = doc.createElement("style");
      style.id = "reader-theme-colors";
      doc.head.appendChild(style);
    }
    style.textContent = css;
  }
}

/**
 * Resolve theme colors for both light and dark modes and register them on an
 * reader rendition. This consolidates the repeated resolve-and-register pattern.
 *
 * NOTE: `themes.register()` is kept as a belt-and-suspenders fallback.  The
 * primary mechanism is `injectThemeColors()` which writes CSS directly into
 * the iframe document, avoiding the empty-style-element bug.
 */
export function registerThemeColors(rendition: {
  themes: {
    register: (name: string, styles: Record<string, Record<string, string>>) => void;
  };
}) {
  const lightColors = resolveThemeColors("light");
  const darkColors = resolveThemeColors("dark");

  const imgContainment = {
    "max-height": "95vh !important",
    "max-width": "100% !important",
    "object-fit": "contain !important",
  };

  const colorInherit = { color: "inherit !important" };

  const lightRoot = {
    color: `${lightColors.foreground} !important`,
    background: `${lightColors.background} !important`,
    "background-color": `${lightColors.background} !important`,
  };
  const darkRoot = {
    color: `${darkColors.foreground} !important`,
    background: `${darkColors.background} !important`,
    "background-color": `${darkColors.background} !important`,
  };

  rendition.themes.register("light", {
    html: lightRoot,
    body: lightRoot,
    a: colorInherit,
    img: imgContainment,
    [COLOR_INHERIT_SELECTORS]: colorInherit,
  });
  rendition.themes.register("dark", {
    html: darkRoot,
    body: darkRoot,
    a: colorInherit,
    img: imgContainment,
    [COLOR_INHERIT_SELECTORS]: colorInherit,
  });
}
