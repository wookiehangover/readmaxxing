/**
 * Color theme definitions for the application.
 *
 * Each theme provides CSS variable overrides for both light and dark modes,
 * plus swatch colors for the theme picker preview chips.
 *
 * CSS variables use oklch() format to match the existing app.css conventions.
 */

export type ColorThemeId =
  | "default"
  | "dracula"
  | "nord"
  | "rose-pine"
  | "tokyo-night"
  | "solarized";

export interface ColorThemeDefinition {
  readonly id: ColorThemeId;
  readonly name: string;
  readonly swatchColors: readonly [string, string, string, string];
  readonly light: Record<string, string>;
  readonly dark: Record<string, string>;
}

/**
 * Default theme — no overrides needed, uses the app.css base variables.
 */
const defaultTheme: ColorThemeDefinition = {
  id: "default",
  name: "Default",
  swatchColors: ["#ffffff", "#0a0a0a", "#f5f5f5", "#737373"],
  light: {},
  dark: {},
};

/**
 * Dracula — https://draculatheme.com/contribute#color-palette
 */
const draculaTheme: ColorThemeDefinition = {
  id: "dracula",
  name: "Dracula",
  swatchColors: ["#282a36", "#bd93f9", "#ff79c6", "#50fa7b"],
  light: {
    "--background": "oklch(0.97 0.005 280)",
    "--foreground": "oklch(0.25 0.02 280)",
    "--card": "oklch(0.95 0.008 280)",
    "--card-foreground": "oklch(0.25 0.02 280)",
    "--popover": "oklch(0.97 0.005 280)",
    "--popover-foreground": "oklch(0.25 0.02 280)",
    "--primary": "oklch(0.55 0.18 295)",
    "--primary-foreground": "oklch(0.98 0 0)",
    "--secondary": "oklch(0.92 0.015 280)",
    "--secondary-foreground": "oklch(0.25 0.02 280)",
    "--muted": "oklch(0.92 0.015 280)",
    "--muted-foreground": "oklch(0.50 0.02 280)",
    "--accent": "oklch(0.75 0.15 340)",
    "--accent-foreground": "oklch(0.20 0.02 280)",
    "--destructive": "oklch(0.65 0.22 15)",
    "--border": "oklch(0.88 0.02 280)",
    "--input": "oklch(0.88 0.02 280)",
    "--ring": "oklch(0.55 0.18 295)",
    "--sidebar": "oklch(0.95 0.008 280)",
    "--sidebar-foreground": "oklch(0.25 0.02 280)",
    "--sidebar-primary": "oklch(0.55 0.18 295)",
    "--sidebar-primary-foreground": "oklch(0.98 0 0)",
    "--sidebar-accent": "oklch(0.92 0.015 280)",
    "--sidebar-accent-foreground": "oklch(0.25 0.02 280)",
    "--sidebar-border": "oklch(0.88 0.02 280)",
    "--sidebar-ring": "oklch(0.55 0.18 295)",
  },
  dark: {
    "--background": "oklch(0.24 0.02 280)",
    "--foreground": "oklch(0.93 0.01 280)",
    "--card": "oklch(0.28 0.02 280)",
    "--card-foreground": "oklch(0.93 0.01 280)",
    "--popover": "oklch(0.28 0.02 280)",
    "--popover-foreground": "oklch(0.93 0.01 280)",
    "--primary": "oklch(0.72 0.17 295)",
    "--primary-foreground": "oklch(0.20 0.02 280)",
    "--secondary": "oklch(0.32 0.02 280)",
    "--secondary-foreground": "oklch(0.93 0.01 280)",
    "--muted": "oklch(0.32 0.02 280)",
    "--muted-foreground": "oklch(0.65 0.02 280)",
    "--accent": "oklch(0.75 0.15 340)",
    "--accent-foreground": "oklch(0.93 0.01 280)",
    "--destructive": "oklch(0.65 0.22 15)",
    "--border": "oklch(0.35 0.02 280)",
    "--input": "oklch(0.35 0.02 280)",
    "--ring": "oklch(0.72 0.17 295)",
    "--sidebar": "oklch(0.22 0.02 280)",
    "--sidebar-foreground": "oklch(0.93 0.01 280)",
    "--sidebar-primary": "oklch(0.72 0.17 295)",
    "--sidebar-primary-foreground": "oklch(0.20 0.02 280)",
    "--sidebar-accent": "oklch(0.32 0.02 280)",
    "--sidebar-accent-foreground": "oklch(0.93 0.01 280)",
    "--sidebar-border": "oklch(0.35 0.02 280)",
    "--sidebar-ring": "oklch(0.72 0.17 295)",
  },
};

/**
 * Nord — https://www.nordtheme.com/docs/colors-and-palettes
 */
const nordTheme: ColorThemeDefinition = {
  id: "nord",
  name: "Nord",
  swatchColors: ["#2e3440", "#88c0d0", "#81a1c1", "#a3be8c"],
  light: {
    "--background": "oklch(0.96 0.005 230)",
    "--foreground": "oklch(0.30 0.02 240)",
    "--card": "oklch(0.94 0.008 230)",
    "--card-foreground": "oklch(0.30 0.02 240)",
    "--popover": "oklch(0.96 0.005 230)",
    "--popover-foreground": "oklch(0.30 0.02 240)",
    "--primary": "oklch(0.60 0.08 240)",
    "--primary-foreground": "oklch(0.98 0 0)",
    "--secondary": "oklch(0.91 0.01 230)",
    "--secondary-foreground": "oklch(0.30 0.02 240)",
    "--muted": "oklch(0.91 0.01 230)",
    "--muted-foreground": "oklch(0.50 0.02 240)",
    "--accent": "oklch(0.72 0.10 200)",
    "--accent-foreground": "oklch(0.25 0.02 240)",
    "--destructive": "oklch(0.60 0.18 20)",
    "--border": "oklch(0.87 0.012 230)",
    "--input": "oklch(0.87 0.012 230)",
    "--ring": "oklch(0.60 0.08 240)",
    "--sidebar": "oklch(0.94 0.008 230)",
    "--sidebar-foreground": "oklch(0.30 0.02 240)",
    "--sidebar-primary": "oklch(0.60 0.08 240)",
    "--sidebar-primary-foreground": "oklch(0.98 0 0)",
    "--sidebar-accent": "oklch(0.91 0.01 230)",
    "--sidebar-accent-foreground": "oklch(0.30 0.02 240)",
    "--sidebar-border": "oklch(0.87 0.012 230)",
    "--sidebar-ring": "oklch(0.60 0.08 240)",
  },
  dark: {
    "--background": "oklch(0.27 0.02 240)",
    "--foreground": "oklch(0.90 0.01 225)",
    "--card": "oklch(0.30 0.02 240)",
    "--card-foreground": "oklch(0.90 0.01 225)",
    "--popover": "oklch(0.30 0.02 240)",
    "--popover-foreground": "oklch(0.90 0.01 225)",
    "--primary": "oklch(0.76 0.08 200)",
    "--primary-foreground": "oklch(0.24 0.02 240)",
    "--secondary": "oklch(0.34 0.02 240)",
    "--secondary-foreground": "oklch(0.90 0.01 225)",
    "--muted": "oklch(0.34 0.02 240)",
    "--muted-foreground": "oklch(0.65 0.02 230)",
    "--accent": "oklch(0.72 0.10 200)",
    "--accent-foreground": "oklch(0.90 0.01 225)",
    "--destructive": "oklch(0.60 0.18 20)",
    "--border": "oklch(0.38 0.02 240)",
    "--input": "oklch(0.38 0.02 240)",
    "--ring": "oklch(0.76 0.08 200)",
    "--sidebar": "oklch(0.24 0.02 240)",
    "--sidebar-foreground": "oklch(0.90 0.01 225)",
    "--sidebar-primary": "oklch(0.76 0.08 200)",
    "--sidebar-primary-foreground": "oklch(0.24 0.02 240)",
    "--sidebar-accent": "oklch(0.34 0.02 240)",
    "--sidebar-accent-foreground": "oklch(0.90 0.01 225)",
    "--sidebar-border": "oklch(0.38 0.02 240)",
    "--sidebar-ring": "oklch(0.76 0.08 200)",
  },
};

/**
 * Rosé Pine — https://rosepinetheme.com/palette
 */
const rosePineTheme: ColorThemeDefinition = {
  id: "rose-pine",
  name: "Rosé Pine",
  swatchColors: ["#191724", "#ebbcba", "#c4a7e7", "#9ccfd8"],
  light: {
    "--background": "oklch(0.96 0.01 340)",
    "--foreground": "oklch(0.30 0.03 300)",
    "--card": "oklch(0.94 0.012 340)",
    "--card-foreground": "oklch(0.30 0.03 300)",
    "--popover": "oklch(0.96 0.01 340)",
    "--popover-foreground": "oklch(0.30 0.03 300)",
    "--primary": "oklch(0.60 0.14 310)",
    "--primary-foreground": "oklch(0.98 0 0)",
    "--secondary": "oklch(0.91 0.015 340)",
    "--secondary-foreground": "oklch(0.30 0.03 300)",
    "--muted": "oklch(0.91 0.015 340)",
    "--muted-foreground": "oklch(0.50 0.03 300)",
    "--accent": "oklch(0.78 0.08 20)",
    "--accent-foreground": "oklch(0.25 0.03 300)",
    "--destructive": "oklch(0.58 0.20 15)",
    "--border": "oklch(0.87 0.018 340)",
    "--input": "oklch(0.87 0.018 340)",
    "--ring": "oklch(0.60 0.14 310)",
    "--sidebar": "oklch(0.94 0.012 340)",
    "--sidebar-foreground": "oklch(0.30 0.03 300)",
    "--sidebar-primary": "oklch(0.60 0.14 310)",
    "--sidebar-primary-foreground": "oklch(0.98 0 0)",
    "--sidebar-accent": "oklch(0.91 0.015 340)",
    "--sidebar-accent-foreground": "oklch(0.30 0.03 300)",
    "--sidebar-border": "oklch(0.87 0.018 340)",
    "--sidebar-ring": "oklch(0.60 0.14 310)",
  },
  dark: {
    "--background": "oklch(0.22 0.03 300)",
    "--foreground": "oklch(0.90 0.01 330)",
    "--card": "oklch(0.26 0.03 300)",
    "--card-foreground": "oklch(0.90 0.01 330)",
    "--popover": "oklch(0.26 0.03 300)",
    "--popover-foreground": "oklch(0.90 0.01 330)",
    "--primary": "oklch(0.75 0.12 310)",
    "--primary-foreground": "oklch(0.20 0.03 300)",
    "--secondary": "oklch(0.30 0.03 300)",
    "--secondary-foreground": "oklch(0.90 0.01 330)",
    "--muted": "oklch(0.30 0.03 300)",
    "--muted-foreground": "oklch(0.60 0.03 310)",
    "--accent": "oklch(0.78 0.08 20)",
    "--accent-foreground": "oklch(0.90 0.01 330)",
    "--destructive": "oklch(0.60 0.20 15)",
    "--border": "oklch(0.35 0.03 300)",
    "--input": "oklch(0.35 0.03 300)",
    "--ring": "oklch(0.75 0.12 310)",
    "--sidebar": "oklch(0.20 0.03 300)",
    "--sidebar-foreground": "oklch(0.90 0.01 330)",
    "--sidebar-primary": "oklch(0.75 0.12 310)",
    "--sidebar-primary-foreground": "oklch(0.20 0.03 300)",
    "--sidebar-accent": "oklch(0.30 0.03 300)",
    "--sidebar-accent-foreground": "oklch(0.90 0.01 330)",
    "--sidebar-border": "oklch(0.35 0.03 300)",
    "--sidebar-ring": "oklch(0.75 0.12 310)",
  },
};

/**
 * Tokyo Night — https://github.com/enkia/tokyo-night-vscode-theme
 */
const tokyoNightTheme: ColorThemeDefinition = {
  id: "tokyo-night",
  name: "Tokyo Night",
  swatchColors: ["#1a1b26", "#7aa2f7", "#bb9af7", "#7dcfff"],
  light: {
    "--background": "oklch(0.96 0.008 260)",
    "--foreground": "oklch(0.28 0.03 260)",
    "--card": "oklch(0.94 0.010 260)",
    "--card-foreground": "oklch(0.28 0.03 260)",
    "--popover": "oklch(0.96 0.008 260)",
    "--popover-foreground": "oklch(0.28 0.03 260)",
    "--primary": "oklch(0.58 0.18 265)",
    "--primary-foreground": "oklch(0.98 0 0)",
    "--secondary": "oklch(0.91 0.012 260)",
    "--secondary-foreground": "oklch(0.28 0.03 260)",
    "--muted": "oklch(0.91 0.012 260)",
    "--muted-foreground": "oklch(0.50 0.03 260)",
    "--accent": "oklch(0.70 0.14 300)",
    "--accent-foreground": "oklch(0.25 0.03 260)",
    "--destructive": "oklch(0.58 0.20 15)",
    "--border": "oklch(0.87 0.015 260)",
    "--input": "oklch(0.87 0.015 260)",
    "--ring": "oklch(0.58 0.18 265)",
    "--sidebar": "oklch(0.94 0.010 260)",
    "--sidebar-foreground": "oklch(0.28 0.03 260)",
    "--sidebar-primary": "oklch(0.58 0.18 265)",
    "--sidebar-primary-foreground": "oklch(0.98 0 0)",
    "--sidebar-accent": "oklch(0.91 0.012 260)",
    "--sidebar-accent-foreground": "oklch(0.28 0.03 260)",
    "--sidebar-border": "oklch(0.87 0.015 260)",
    "--sidebar-ring": "oklch(0.58 0.18 265)",
  },
  dark: {
    "--background": "oklch(0.21 0.03 260)",
    "--foreground": "oklch(0.88 0.01 260)",
    "--card": "oklch(0.25 0.03 260)",
    "--card-foreground": "oklch(0.88 0.01 260)",
    "--popover": "oklch(0.25 0.03 260)",
    "--popover-foreground": "oklch(0.88 0.01 260)",
    "--primary": "oklch(0.72 0.15 265)",
    "--primary-foreground": "oklch(0.18 0.03 260)",
    "--secondary": "oklch(0.30 0.03 260)",
    "--secondary-foreground": "oklch(0.88 0.01 260)",
    "--muted": "oklch(0.30 0.03 260)",
    "--muted-foreground": "oklch(0.60 0.03 260)",
    "--accent": "oklch(0.70 0.14 300)",
    "--accent-foreground": "oklch(0.88 0.01 260)",
    "--destructive": "oklch(0.60 0.20 15)",
    "--border": "oklch(0.33 0.03 260)",
    "--input": "oklch(0.33 0.03 260)",
    "--ring": "oklch(0.72 0.15 265)",
    "--sidebar": "oklch(0.18 0.03 260)",
    "--sidebar-foreground": "oklch(0.88 0.01 260)",
    "--sidebar-primary": "oklch(0.72 0.15 265)",
    "--sidebar-primary-foreground": "oklch(0.18 0.03 260)",
    "--sidebar-accent": "oklch(0.30 0.03 260)",
    "--sidebar-accent-foreground": "oklch(0.88 0.01 260)",
    "--sidebar-border": "oklch(0.33 0.03 260)",
    "--sidebar-ring": "oklch(0.72 0.15 265)",
  },
};

/**
 * Solarized — https://ethanschoonover.com/solarized/
 */
const solarizedTheme: ColorThemeDefinition = {
  id: "solarized",
  name: "Solarized",
  swatchColors: ["#002b36", "#268bd2", "#2aa198", "#b58900"],
  light: {
    "--background": "oklch(0.95 0.015 80)",
    "--foreground": "oklch(0.35 0.04 230)",
    "--card": "oklch(0.93 0.018 80)",
    "--card-foreground": "oklch(0.35 0.04 230)",
    "--popover": "oklch(0.95 0.015 80)",
    "--popover-foreground": "oklch(0.35 0.04 230)",
    "--primary": "oklch(0.55 0.14 240)",
    "--primary-foreground": "oklch(0.95 0.015 80)",
    "--secondary": "oklch(0.90 0.02 80)",
    "--secondary-foreground": "oklch(0.35 0.04 230)",
    "--muted": "oklch(0.90 0.02 80)",
    "--muted-foreground": "oklch(0.52 0.03 200)",
    "--accent": "oklch(0.65 0.12 190)",
    "--accent-foreground": "oklch(0.30 0.04 230)",
    "--destructive": "oklch(0.52 0.19 25)",
    "--border": "oklch(0.85 0.025 80)",
    "--input": "oklch(0.85 0.025 80)",
    "--ring": "oklch(0.55 0.14 240)",
    "--sidebar": "oklch(0.93 0.018 80)",
    "--sidebar-foreground": "oklch(0.35 0.04 230)",
    "--sidebar-primary": "oklch(0.55 0.14 240)",
    "--sidebar-primary-foreground": "oklch(0.95 0.015 80)",
    "--sidebar-accent": "oklch(0.90 0.02 80)",
    "--sidebar-accent-foreground": "oklch(0.35 0.04 230)",
    "--sidebar-border": "oklch(0.85 0.025 80)",
    "--sidebar-ring": "oklch(0.55 0.14 240)",
  },
  dark: {
    "--background": "oklch(0.22 0.04 210)",
    "--foreground": "oklch(0.82 0.03 80)",
    "--card": "oklch(0.26 0.04 210)",
    "--card-foreground": "oklch(0.82 0.03 80)",
    "--popover": "oklch(0.26 0.04 210)",
    "--popover-foreground": "oklch(0.82 0.03 80)",
    "--primary": "oklch(0.62 0.14 240)",
    "--primary-foreground": "oklch(0.20 0.04 210)",
    "--secondary": "oklch(0.30 0.04 210)",
    "--secondary-foreground": "oklch(0.82 0.03 80)",
    "--muted": "oklch(0.30 0.04 210)",
    "--muted-foreground": "oklch(0.58 0.03 200)",
    "--accent": "oklch(0.65 0.12 190)",
    "--accent-foreground": "oklch(0.82 0.03 80)",
    "--destructive": "oklch(0.55 0.19 25)",
    "--border": "oklch(0.34 0.04 210)",
    "--input": "oklch(0.34 0.04 210)",
    "--ring": "oklch(0.62 0.14 240)",
    "--sidebar": "oklch(0.20 0.04 210)",
    "--sidebar-foreground": "oklch(0.82 0.03 80)",
    "--sidebar-primary": "oklch(0.62 0.14 240)",
    "--sidebar-primary-foreground": "oklch(0.20 0.04 210)",
    "--sidebar-accent": "oklch(0.30 0.04 210)",
    "--sidebar-accent-foreground": "oklch(0.82 0.03 80)",
    "--sidebar-border": "oklch(0.34 0.04 210)",
    "--sidebar-ring": "oklch(0.62 0.14 240)",
  },
};

/**
 * All available color themes, keyed by ID.
 */
export const COLOR_THEMES: Record<ColorThemeId, ColorThemeDefinition> = {
  default: defaultTheme,
  dracula: draculaTheme,
  nord: nordTheme,
  "rose-pine": rosePineTheme,
  "tokyo-night": tokyoNightTheme,
  solarized: solarizedTheme,
};

/**
 * Ordered list of all theme IDs for UI iteration.
 */
export const COLOR_THEME_IDS: readonly ColorThemeId[] = [
  "default",
  "dracula",
  "nord",
  "rose-pine",
  "tokyo-night",
  "solarized",
] as const;

/**
 * Look up a theme definition by ID, falling back to default.
 */
export function getColorTheme(id: ColorThemeId): ColorThemeDefinition {
  return COLOR_THEMES[id] ?? COLOR_THEMES.default;
}
