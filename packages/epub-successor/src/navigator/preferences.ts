import { PREFERENCE_STYLE_ID } from "../content-pipeline/content-pipeline";

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

export type NavigatorFlow = "scrolled" | "paginated";
export type NavigatorSpread = "single" | "double";
export type NavigatorTheme = "light" | "dark" | "sepia";

export interface NavigatorPreferences {
  readonly readerBaseCss?: string;
  readonly preferenceCss?: string;
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly margins?: number;
  readonly theme?: NavigatorTheme;
  readonly flow?: NavigatorFlow;
  readonly spread?: NavigatorSpread;
  readonly minSpreadWidth?: number;
  /** Resting inline margin inside a single-page paginated viewport. */
  readonly pageInlineMargin?: number;
  readonly pageTurnAnimation?: "none" | "slide";
  readonly pageTurnDurationMs?: number;
}

const THEME_COLORS: Readonly<Record<NavigatorTheme, readonly [string, string]>> = {
  light: ["#171717", "#ffffff"],
  dark: ["#e5e5e5", "#171717"],
  sepia: ["#433422", "#f4ecd8"],
};

function finitePositive(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

function finiteNonNegative(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function mergePreferences(
  current: NavigatorPreferences,
  update: NavigatorPreferences,
): NavigatorPreferences {
  return { ...current, ...update };
}

export function buildPreferenceCss(preferences: NavigatorPreferences): string {
  const declarations: string[] = [];
  if (preferences.fontFamily)
    declarations.push(`font-family:${JSON.stringify(preferences.fontFamily)} !important`);
  const fontSize = finitePositive(preferences.fontSize);
  if (fontSize !== undefined) declarations.push(`font-size:${fontSize}% !important`);
  const lineHeight = finitePositive(preferences.lineHeight);
  if (lineHeight !== undefined) declarations.push(`line-height:${lineHeight} !important`);
  const margins = finiteNonNegative(preferences.margins);
  if (margins !== undefined) declarations.push(`padding:${margins}px !important`);

  const theme = preferences.theme ? THEME_COLORS[preferences.theme] : undefined;
  // Prefer preferenceCss (app-resolved colors) over hard-coded THEME_COLORS so
  // html/body stay in lockstep with the host UI. Keep THEME_COLORS as a base
  // for the package demo when preferenceCss is omitted.
  const themeCss = theme
    ? `html,body{color:${theme[0]} !important;background:${theme[1]} !important;background-color:${theme[1]} !important;}`
    : "";
  const bodyCss = declarations.length > 0 ? `body{${declarations.join(";")};}` : "";
  return [themeCss, bodyCss, preferences.preferenceCss].filter(Boolean).join("\n");
}

export function applyPreferences(document: Document, preferences: NavigatorPreferences): void {
  let style = document.getElementById(PREFERENCE_STYLE_ID);
  if (!style) {
    style = document.createElementNS(XHTML_NAMESPACE, "style");
    style.id = PREFERENCE_STYLE_ID;
    (document.head ?? document.documentElement).append(style);
  }
  style.textContent = buildPreferenceCss(preferences);
}
