import { useState, useCallback, useEffect, useSyncExternalStore } from "react";
import { z } from "zod";
import { recordChange } from "~/lib/sync/change-log";

export type Theme = "light" | "dark" | "system";
export type ReaderLayout = "single" | "spread" | "scroll";
export type PdfLayout = "original" | "fit-height" | "fit-width" | "two-page" | "continuous";
export type WorkspaceSortBy = "title" | "author" | "recent";
export type LibraryView = "grid" | "table" | "stack";
export type StandardEbooksView = "grid" | "table";
export type TextAlign = "left" | "center" | "right" | "justify" | undefined;
export type FontWeight = 300 | 400 | 500 | 600 | 700;

const LegacyFontSize = z.preprocess((val) => {
  if (typeof val !== "number" || Number.isNaN(val)) return 100;
  return val <= 40 ? Math.round(val / 0.16) : val;
}, z.number());

export const SyncedSettingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).default("system"),
  colorTheme: z
    .enum(["default", "dracula", "nord", "rose-pine", "tokyo-night", "solarized"])
    .default("default"),
  updatedAt: z.number().optional(),
});

export const FOCUSED_SPLIT_RATIO_MIN = 0.2;
export const FOCUSED_SPLIT_RATIO_MAX = 0.8;
export const FOCUSED_SPLIT_RATIO_DEFAULT = 0.5;

export function clampFocusedSplitRatio(v: number): number {
  if (!Number.isFinite(v)) return FOCUSED_SPLIT_RATIO_DEFAULT;
  return Math.min(FOCUSED_SPLIT_RATIO_MAX, Math.max(FOCUSED_SPLIT_RATIO_MIN, v));
}

export const LocalUISettingsSchema = z.object({
  readerLayout: z.enum(["single", "spread", "scroll"]).default("single"),
  pdfLayout: z
    .enum(["original", "fit-height", "fit-width", "two-page", "continuous"])
    .default("fit-height"),
  sidebarCollapsed: z.boolean().default(false),
  zenMode: z.boolean().default(false),
  libraryView: z.enum(["grid", "table", "stack"]).default("stack"),
  standardEbooksView: z.enum(["grid", "table"]).default("grid"),
  workspaceSortBy: z.enum(["title", "author", "recent"]).default("recent"),
  focusedSplitRatio: z.number().default(FOCUSED_SPLIT_RATIO_DEFAULT),
  fontFamily: z.string().default("Literata"),
  fontSize: LegacyFontSize.default(100),
  fontWeight: z
    .union([z.literal(300), z.literal(400), z.literal(500), z.literal(600), z.literal(700)])
    .default(400),
  lineHeight: z.number().default(1.6),
  textAlign: z.enum(["left", "center", "right", "justify"]).optional(),
});

export const SettingsSchema = z.object({
  ...SyncedSettingsSchema.shape,
  ...LocalUISettingsSchema.shape,
});

export type SyncedSettings = z.infer<typeof SyncedSettingsSchema>;
export type LocalUISettings = z.infer<typeof LocalUISettingsSchema>;
export type Settings = z.infer<typeof SettingsSchema>;

export const SYNCED_SETTINGS_KEYS = [
  "theme",
  "colorTheme",
] as const satisfies readonly (keyof SyncedSettings)[];

export const LOCAL_UI_SETTINGS_KEYS = [
  "readerLayout",
  "pdfLayout",
  "sidebarCollapsed",
  "libraryView",
  "standardEbooksView",
  "workspaceSortBy",
  "focusedSplitRatio",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "textAlign",
] as const satisfies readonly (keyof LocalUISettings)[];

const decodeSynced = (input: unknown) => SyncedSettingsSchema.parse(input);
const decodeLocalUI = (input: unknown) => LocalUISettingsSchema.parse(input);

const STORAGE_KEY = "app-settings";
const LOCAL_UI_STORAGE_KEY = "app-ui-settings";

const defaultSettings: Settings = {
  theme: "system",
  readerLayout: "single",
  pdfLayout: "fit-height",
  fontFamily: "Literata",
  fontSize: 100,
  fontWeight: 400,
  lineHeight: 1.6,
  textAlign: undefined,
  sidebarCollapsed: false,
  zenMode: false,
  workspaceSortBy: "recent",
  libraryView: "stack",
  standardEbooksView: "grid",
  colorTheme: "default",
  focusedSplitRatio: FOCUSED_SPLIT_RATIO_DEFAULT,
};

function readRaw(key: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function migrateLegacySettings(): void {
  const legacy = readRaw(STORAGE_KEY);
  if (!legacy) return;
  const hasUIFields = LOCAL_UI_SETTINGS_KEYS.some((k) => k in legacy);
  if (!hasUIFields) return;

  const existingLocal = readRaw(LOCAL_UI_STORAGE_KEY) ?? {};
  const promoted: Record<string, unknown> = { ...existingLocal };
  for (const k of LOCAL_UI_SETTINGS_KEYS) {
    if (k in existingLocal) continue;
    if (k in legacy) promoted[k] = legacy[k];
  }
  localStorage.setItem(LOCAL_UI_STORAGE_KEY, JSON.stringify(promoted));

  const localKeySet = new Set<string>(LOCAL_UI_SETTINGS_KEYS);
  const pruned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(legacy)) {
    if (!localKeySet.has(k)) pruned[k] = v;
  }

  delete pruned.updatedAt;

  localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
}

function readSynced(): SyncedSettings {
  try {
    return decodeSynced(readRaw(STORAGE_KEY) ?? {});
  } catch {
    return decodeSynced({});
  }
}

function readLocalUI(): LocalUISettings {
  const raw = readRaw(LOCAL_UI_STORAGE_KEY) ?? {};
  if (raw.pdfLayout === "fit") raw.pdfLayout = "fit-height";
  let decoded: LocalUISettings;
  try {
    decoded = decodeLocalUI(raw);
  } catch {
    decoded = decodeLocalUI({});
  }
  return { ...decoded, focusedSplitRatio: clampFocusedSplitRatio(decoded.focusedSplitRatio) };
}

export function getSettings(): Settings {
  if (typeof window === "undefined") return defaultSettings;
  try {
    migrateLegacySettings();
    return { ...readSynced(), ...readLocalUI() };
  } catch {
    return defaultSettings;
  }
}

const SETTINGS_CHANGED_EVENT = "settings-changed";

function pickKeys<T>(obj: T, keys: readonly (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) {
    if (obj != null && k in (obj as object)) out[k] = obj[k];
  }
  return out;
}

function equalByKeys<T extends Record<string, unknown>>(
  a: T,
  b: T,
  keys: readonly (keyof T)[],
): boolean {
  for (const k of keys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

export function saveSettings(settings: Settings): void {
  if (typeof window === "undefined") return;
  migrateLegacySettings();
  const currentSynced = readSynced();
  const currentLocal = readLocalUI();

  const nextSynced = pickKeys(settings as SyncedSettings, SYNCED_SETTINGS_KEYS);
  const nextLocalRaw = pickKeys(settings as LocalUISettings, LOCAL_UI_SETTINGS_KEYS);
  const nextLocal: Partial<LocalUISettings> =
    "focusedSplitRatio" in nextLocalRaw && typeof nextLocalRaw.focusedSplitRatio === "number"
      ? {
          ...nextLocalRaw,
          focusedSplitRatio: clampFocusedSplitRatio(nextLocalRaw.focusedSplitRatio),
        }
      : nextLocalRaw;

  const mergedSynced = { ...currentSynced, ...nextSynced } as SyncedSettings;
  const mergedLocal = { ...currentLocal, ...nextLocal } as LocalUISettings;

  const syncedChanged = !equalByKeys(
    currentSynced as Record<string, unknown>,
    mergedSynced as Record<string, unknown>,
    SYNCED_SETTINGS_KEYS,
  );
  const localChanged = !equalByKeys(
    currentLocal as Record<string, unknown>,
    mergedLocal as Record<string, unknown>,
    LOCAL_UI_SETTINGS_KEYS,
  );

  let shouldEmit = false;

  if (syncedChanged) {
    const stamped: SyncedSettings = { ...mergedSynced, updatedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stamped));
    recordChange({
      entity: "settings",
      entityId: "user-settings",
      operation: "put",
      data: stamped,
      timestamp: stamped.updatedAt!,
    }).catch(console.error);
    shouldEmit = true;
  }

  if (localChanged) {
    localStorage.setItem(LOCAL_UI_STORAGE_KEY, JSON.stringify(mergedLocal));
    shouldEmit = true;
  }

  if (shouldEmit) {
    queueMicrotask(() => {
      window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT));
    });
  }
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
      if (e.key === STORAGE_KEY || e.key === LOCAL_UI_STORAGE_KEY) setSettings(getSettings());
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

export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";

function subscribeToSystemTheme(onStoreChange: () => void): () => void {
  const media = window.matchMedia(SYSTEM_THEME_QUERY);
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia(SYSTEM_THEME_QUERY).matches ? "dark" : "light";
}

export function useResolvedTheme(theme: Theme): "light" | "dark" {
  const systemTheme = useSyncExternalStore(
    subscribeToSystemTheme,
    getSystemTheme,
    (): "light" => "light",
  );
  return theme === "system" ? systemTheme : theme;
}
