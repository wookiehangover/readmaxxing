export function resolveThemeColors(mode: "light" | "dark") {
  const root = document.documentElement;
  const currentlyDark = root.classList.contains("dark");
  const needsDark = mode === "dark";

  if (needsDark !== currentlyDark) {
    root.classList.toggle("dark", needsDark);
  }

  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.backgroundColor = "var(--background)";
  probe.style.color = "var(--foreground)";
  document.body.appendChild(probe);

  void probe.offsetHeight;

  const computed = getComputedStyle(probe);
  const background = computed.backgroundColor;
  const foreground = computed.color;

  document.body.removeChild(probe);

  if (needsDark !== currentlyDark) {
    root.classList.toggle("dark", currentlyDark);
  }

  return { background, foreground };
}

const COLOR_INHERIT_SELECTORS =
  "p, span, div, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, figcaption, cite, em, strong, b, i, u, small, sub, sup, dd, dt, label";

const IMG_CONTAINMENT_CSS = `img {
  max-height: 95vh !important;
  max-width: 100% !important;
  object-fit: contain !important;
}`;

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
