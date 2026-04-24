import { useState, useCallback, useEffect } from "react";
import { Schema } from "effect";
import { recordChange } from "~/lib/sync/change-log";

export type Theme = "light" | "dark" | "system";
export type ReaderLayout = "single" | "spread" | "scroll";
export type PdfLayout = "original" | "fit-height" | "fit-width" | "two-page" | "continuous";
export type WorkspaceSortBy = "title" | "author" | "recent";
export type LibraryView = "grid" | "table";
export type LayoutMode = "focused" | "freeform";

// --- Schema ---

/**
 * Font size schema with legacy migration transform.
 * Old values were pixel-based (≤40); new values are percentage-based (>40).
 */
const LegacyFontSize = Schema.transform(Schema.Unknown, Schema.Number, {
  strict: true,
  decode: (val) => {
    if (typeof val !== "number" || Number.isNaN(val)) return 100;
    return val <= 40 ? Math.round(val / 0.16) : val;
  },
  encode: (val) => val,
});

/** Settings that sync across devices via the "settings" entity (LWW). */
export const SyncedSettingsSchema = Schema.Struct({
  theme: Schema.optionalWith(Schema.Literal("light", "dark", "system"), {
    default: () => "system" as const,
  }),
  fontFamily: Schema.optionalWith(Schema.String, { default: () => "Literata" }),
  fontSize: Schema.optionalWith(LegacyFontSize, { default: () => 100 }),
  lineHeight: Schema.optionalWith(Schema.Number, { default: () => 1.6 }),
  colorTheme: Schema.optionalWith(
    Schema.Literal("default", "dracula", "nord", "rose-pine", "tokyo-night", "solarized"),
    { default: () => "default" as const },
  ),
  /** Timestamp of last synced settings change. Used for LWW sync. */
  updatedAt: Schema.optional(Schema.Number),
});

/** Bounds for `focusedSplitRatio` so a degenerate value can't strand a panel. */
export const FOCUSED_SPLIT_RATIO_MIN = 0.2;
export const FOCUSED_SPLIT_RATIO_MAX = 0.8;
export const FOCUSED_SPLIT_RATIO_DEFAULT = 0.5;

/**
 * Clamp `focusedSplitRatio` to the supported bounds. Falls back to the default
 * for non-finite inputs so a corrupt localStorage entry can't permanently
 * collapse a panel.
 */
export function clampFocusedSplitRatio(v: number): number {
  if (!Number.isFinite(v)) return FOCUSED_SPLIT_RATIO_DEFAULT;
  return Math.min(FOCUSED_SPLIT_RATIO_MAX, Math.max(FOCUSED_SPLIT_RATIO_MIN, v));
}

/** Settings that stay local to the browser/device and never sync. */
export const LocalUISettingsSchema = Schema.Struct({
  readerLayout: Schema.optionalWith(Schema.Literal("single", "spread", "scroll"), {
    default: () => "single" as const,
  }),
  pdfLayout: Schema.optionalWith(
    Schema.Literal("original", "fit-height", "fit-width", "two-page", "continuous"),
    { default: () => "fit-height" as const },
  ),
  sidebarCollapsed: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  libraryView: Schema.optionalWith(Schema.Literal("grid", "table"), {
    default: () => "grid" as const,
  }),
  workspaceSortBy: Schema.optionalWith(Schema.Literal("title", "author", "recent"), {
    default: () => "recent" as const,
  }),
  layoutMode: Schema.optionalWith(Schema.Literal("focused", "freeform"), {
    default: () => "focused" as const,
  }),
  /**
   * Fraction of the focused-mode workspace allocated to the book-reader group
   * (the right-side chat/notebook group gets `1 - focusedSplitRatio`). Single
   * global value across all clusters. Bounded on read and on write via
   * `clampFocusedSplitRatio`.
   */
  focusedSplitRatio: Schema.optionalWith(Schema.Number, {
    default: () => FOCUSED_SPLIT_RATIO_DEFAULT,
  }),
});

/** Backward-compatible merged shape exposed to call sites. */
export const SettingsSchema = Schema.Struct({
  ...SyncedSettingsSchema.fields,
  ...LocalUISettingsSchema.fields,
});

export type SyncedSettings = typeof SyncedSettingsSchema.Type;
export type LocalUISettings = typeof LocalUISettingsSchema.Type;
export type Settings = typeof SettingsSchema.Type;

export const SYNCED_SETTINGS_KEYS = [
  "theme",
  "fontFamily",
  "fontSize",
  "lineHeight",
  "colorTheme",
] as const satisfies readonly (keyof SyncedSettings)[];

export const LOCAL_UI_SETTINGS_KEYS = [
  "readerLayout",
  "pdfLayout",
  "sidebarCollapsed",
  "libraryView",
  "workspaceSortBy",
  "layoutMode",
  "focusedSplitRatio",
] as const satisfies readonly (keyof LocalUISettings)[];

const decodeSynced = Schema.decodeUnknownSync(SyncedSettingsSchema);
const decodeLocalUI = Schema.decodeUnknownSync(LocalUISettingsSchema);

const STORAGE_KEY = "app-settings";
const LOCAL_UI_STORAGE_KEY = "app-ui-settings";

const defaultSettings: Settings = {
  theme: "system",
  readerLayout: "single",
  pdfLayout: "fit-height",
  fontFamily: "Literata",
  fontSize: 100,
  lineHeight: 1.6,
  sidebarCollapsed: false,
  workspaceSortBy: "recent",
  libraryView: "grid",
  colorTheme: "default",
  layoutMode: "focused",
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

/**
 * Move any UI fields out of the legacy `app-settings` blob into the dedicated
 * local-only bucket, leaving only synced fields behind. Idempotent: if the
 * local bucket already has a key, that value wins and the legacy copy is
 * pruned.
 */
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
  // Migrate legacy "fit" value to "fit-height"
  if (raw.pdfLayout === "fit") raw.pdfLayout = "fit-height";
  let decoded: LocalUISettings;
  try {
    decoded = decodeLocalUI(raw);
  } catch {
    decoded = decodeLocalUI({});
  }
  // Clamp on read so a corrupt or out-of-range stored value can't strand a
  // panel. Mirrors the clamp applied in `saveSettings`.
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
  // Clamp on write so callers that persist a raw computed ratio can't push an
  // out-of-range value into localStorage. Mirrors the clamp on read.
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

/**
 * Resolve the effective theme based on the setting and system preference.
 */
export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
