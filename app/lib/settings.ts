import { useState, useEffect, useCallback } from "react";

export type Theme = "light" | "dark" | "system";
export type ReaderLayout = "single" | "spread" | "scroll";
export type WorkspaceSortBy = "title" | "author" | "recent";

export interface Settings {
  theme: Theme;
  readerLayout: ReaderLayout;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  sidebarCollapsed: boolean;
  workspaceSortBy: WorkspaceSortBy;
}

const STORAGE_KEY = "app-settings";

const defaultSettings: Settings = {
  theme: "system",
  readerLayout: "single",
  fontFamily: "Literata",
  fontSize: 100,
  lineHeight: 1.6,
  sidebarCollapsed: false,
  workspaceSortBy: "recent",
};

function normalizeLegacyFontSize(fontSize: unknown): number {
  if (typeof fontSize !== "number" || Number.isNaN(fontSize)) {
    return defaultSettings.fontSize;
  }

  return fontSize <= 40 ? Math.round(fontSize / 0.16) : fontSize;
}

export function getSettings(): Settings {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...defaultSettings,
      ...parsed,
      fontSize: normalizeLegacyFontSize(parsed.fontSize),
    };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: Settings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function useSettings(): [Settings, (update: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings>(defaultSettings);

  useEffect(() => {
    setSettings(getSettings());
  }, []);

  const updateSettings = useCallback((update: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...update };
      saveSettings(next);
      return next;
    });
  }, []);

  return [settings, updateSettings];
}

/**
 * Resolve the effective theme based on the setting and system preference.
 */
export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
