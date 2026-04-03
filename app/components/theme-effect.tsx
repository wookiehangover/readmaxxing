import { useEffect } from "react";
import { useSettings, resolveTheme } from "~/lib/settings";
import { getColorTheme } from "~/lib/color-themes";

/**
 * Apply a color theme's CSS variable overrides to the document.
 *
 * For "default" theme, removes any overrides so the CSS file defaults take effect.
 * For other themes, sets CSS variables on both :root and .dark selectors via
 * inline style properties on `document.documentElement`.
 */
function applyColorThemeVars(themeId: string, mode: "light" | "dark") {
  const theme = getColorTheme(themeId as any);
  const root = document.documentElement;

  // Get the variable overrides for the current mode
  const vars = mode === "dark" ? theme.dark : theme.light;

  // Collect all variable names across both light and dark to ensure cleanup
  const allVarNames = new Set([...Object.keys(theme.light), ...Object.keys(theme.dark)]);

  if (themeId === "default" || allVarNames.size === 0) {
    // Remove any previously-set overrides so CSS file defaults take effect
    for (const name of allVarNames) {
      root.style.removeProperty(name);
    }
    // Also clean up any lingering vars from a previous non-default theme
    // by checking for common CSS variable names used by themes
    const commonVars = [
      "--background",
      "--foreground",
      "--card",
      "--card-foreground",
      "--popover",
      "--popover-foreground",
      "--primary",
      "--primary-foreground",
      "--secondary",
      "--secondary-foreground",
      "--muted",
      "--muted-foreground",
      "--accent",
      "--accent-foreground",
      "--destructive",
      "--border",
      "--input",
      "--ring",
      "--sidebar",
      "--sidebar-foreground",
      "--sidebar-primary",
      "--sidebar-primary-foreground",
      "--sidebar-accent",
      "--sidebar-accent-foreground",
      "--sidebar-border",
      "--sidebar-ring",
    ];
    for (const name of commonVars) {
      root.style.removeProperty(name);
    }
    return;
  }

  // Set the overrides for the active mode
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }

  // Remove any variables that exist in the other mode but not the current one
  const otherVars = mode === "dark" ? theme.light : theme.dark;
  for (const name of Object.keys(otherVars)) {
    if (!(name in vars)) {
      root.style.removeProperty(name);
    }
  }
}

export function ThemeEffect() {
  const [settings] = useSettings();

  // Apply theme class to <html> whenever settings change
  useEffect(() => {
    const resolved = resolveTheme(settings.theme);
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [settings.theme]);

  // Apply color theme CSS variables whenever theme or colorTheme changes
  useEffect(() => {
    const mode = resolveTheme(settings.theme);
    applyColorThemeVars(settings.colorTheme, mode);
  }, [settings.theme, settings.colorTheme]);

  // Listen for system preference changes when theme is "system"
  useEffect(() => {
    if (settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const isDark = mq.matches;
      document.documentElement.classList.toggle("dark", isDark);
      applyColorThemeVars(settings.colorTheme, isDark ? "dark" : "light");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [settings.theme, settings.colorTheme]);

  return null;
}
