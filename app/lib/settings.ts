import { useState, useCallback, useEffect } from "react";
import { Schema } from "effect";

export type Theme = "light" | "dark" | "system";
export type ReaderLayout = "single" | "spread" | "scroll";
export type WorkspaceSortBy = "title" | "author" | "recent";

// --- Schema ---

/**
 * Font size schema with legacy migration transform.
 * Old values were pixel-based (≤40); new values are percentage-based (>40).
 * The transform converts legacy pixel values to percentages.
 */
const LegacyFontSize = Schema.transform(Schema.Unknown, Schema.Number, {
  strict: true,
  decode: (val) => {
    if (typeof val !== "number" || Number.isNaN(val)) return 100;
    return val <= 40 ? Math.round(val / 0.16) : val;
  },
  encode: (val) => val,
});

export const SettingsSchema = Schema.Struct({
  theme: Schema.optionalWith(Schema.Literal("light", "dark", "system"), {
    default: () => "system" as const,
  }),
  readerLayout: Schema.optionalWith(Schema.Literal("single", "spread", "scroll"), {
    default: () => "single" as const,
  }),
  fontFamily: Schema.optionalWith(Schema.String, { default: () => "Literata" }),
  fontSize: Schema.optionalWith(LegacyFontSize, { default: () => 100 }),
  lineHeight: Schema.optionalWith(Schema.Number, { default: () => 1.6 }),
  sidebarCollapsed: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  workspaceSortBy: Schema.optionalWith(Schema.Literal("title", "author", "recent"), {
    default: () => "recent" as const,
  }),
});

export type Settings = typeof SettingsSchema.Type;

const decodeSettings = Schema.decodeUnknownSync(SettingsSchema);

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

export function getSettings(): Settings {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw);
    return decodeSettings(parsed);
  } catch {
    return defaultSettings;
  }
}

const SETTINGS_CHANGED_EVENT = "settings-changed";

export function saveSettings(settings: Settings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT));
}

export function useSettings(): [Settings, (update: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings>(() => {
    if (typeof window === "undefined") return defaultSettings;
    return getSettings();
  });

  useEffect(() => {
    const handler = () => setSettings(getSettings());
    window.addEventListener(SETTINGS_CHANGED_EVENT, handler);
    const storageHandler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setSettings(getSettings());
    };
    window.addEventListener("storage", storageHandler);
    return () => {
      window.removeEventListener(SETTINGS_CHANGED_EVENT, handler);
      window.removeEventListener("storage", storageHandler);
    };
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
