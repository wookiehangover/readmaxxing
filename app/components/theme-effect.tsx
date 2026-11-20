import { useEffect } from "react";
import { useSettings, resolveTheme } from "~/lib/settings";
import { getColorTheme } from "~/lib/color-themes";

function applyColorThemeVars(themeId: string, mode: "light" | "dark") {
  const theme = getColorTheme(themeId as any);
  const root = document.documentElement;

  const vars = mode === "dark" ? theme.dark : theme.light;

  const allVarNames = new Set([...Object.keys(theme.light), ...Object.keys(theme.dark)]);

  if (themeId === "default" || allVarNames.size === 0) {
    for (const name of allVarNames) {
      root.style.removeProperty(name);
    }
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

  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }

  const otherVars = mode === "dark" ? theme.light : theme.dark;
  for (const name of Object.keys(otherVars)) {
    if (!(name in vars)) {
      root.style.removeProperty(name);
    }
  }
}

function updateThemeColorMeta() {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) return;

  const background = getComputedStyle(document.body).backgroundColor;
  meta.content =
    background || (document.documentElement.classList.contains("dark") ? "#0a0a0a" : "#ffffff");
}

export function ThemeEffect() {
  const [settings] = useSettings();

  useEffect(() => {
    const resolved = resolveTheme(settings.theme);
    document.documentElement.classList.toggle("dark", resolved === "dark");
    updateThemeColorMeta();
  }, [settings.theme]);

  useEffect(() => {
    const mode = resolveTheme(settings.theme);
    applyColorThemeVars(settings.colorTheme, mode);
    updateThemeColorMeta();
  }, [settings.theme, settings.colorTheme]);

  useEffect(() => {
    if (settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const isDark = mq.matches;
      document.documentElement.classList.toggle("dark", isDark);
      applyColorThemeVars(settings.colorTheme, isDark ? "dark" : "light");
      updateThemeColorMeta();
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [settings.theme, settings.colorTheme]);

  return null;
}
