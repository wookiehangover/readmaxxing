import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/sync/change-log", () => ({
  recordChange: vi.fn().mockResolvedValue(undefined),
}));

import { recordChange } from "~/lib/sync/change-log";
import {
  getSettings,
  saveSettings,
  resolveTheme,
  SYNCED_SETTINGS_KEYS,
  LOCAL_UI_SETTINGS_KEYS,
  FOCUSED_SPLIT_RATIO_DEFAULT,
  FOCUSED_SPLIT_RATIO_MIN,
  FOCUSED_SPLIT_RATIO_MAX,
  clampFocusedSplitRatio,
} from "../settings";
import type { Settings } from "../settings";

const STORAGE_KEY = "app-settings";
const LOCAL_UI_STORAGE_KEY = "app-ui-settings";

const defaultSettings: Settings = {
  theme: "system",
  readerLayout: "single",
  fontFamily: "Literata",
  fontSize: 100,
  lineHeight: 1.6,
  textAlign: undefined,
  sidebarCollapsed: false,
  workspaceSortBy: "recent",
  librarySortBy: "author",
  libraryView: "grid",
  pdfLayout: "fit-height",
  colorTheme: "default",
  layoutMode: "focused",
  zenMode: false,
  focusedSplitRatio: FOCUSED_SPLIT_RATIO_DEFAULT,
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(recordChange).mockClear();
});

describe("getSettings", () => {
  it("returns default settings when localStorage is empty", () => {
    expect(getSettings()).toEqual(defaultSettings);
  });

  it("merges synced and local buckets into a single object", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: "dark" }));
    localStorage.setItem(
      LOCAL_UI_STORAGE_KEY,
      JSON.stringify({ fontSize: 120, sidebarCollapsed: true, layoutMode: "freeform" }),
    );
    expect(getSettings()).toEqual({
      ...defaultSettings,
      theme: "dark",
      fontSize: 120,
      sidebarCollapsed: true,
      layoutMode: "freeform",
    });
  });

  it("returns defaults when localStorage contains corrupt JSON", () => {
    localStorage.setItem(STORAGE_KEY, "not-valid-json{{{");
    localStorage.setItem(LOCAL_UI_STORAGE_KEY, "also-corrupt{{{");
    expect(getSettings()).toEqual(defaultSettings);
  });

  it("returns defaults when localStorage contains empty string", () => {
    localStorage.setItem(STORAGE_KEY, "");
    expect(getSettings()).toEqual(defaultSettings);
  });
});

describe("legacy migration", () => {
  it("moves UI fields from legacy blob to local bucket on first read", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        theme: "dark",
        fontSize: 120,
        sidebarCollapsed: true,
        layoutMode: "freeform",
        libraryView: "table",
        updatedAt: 1000,
      }),
    );
    const result = getSettings();
    expect(result.theme).toBe("dark");
    expect(result.fontSize).toBe(120);
    expect(result.sidebarCollapsed).toBe(true);
    expect(result.layoutMode).toBe("freeform");
    expect(result.libraryView).toBe("table");

    const syncedRaw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    for (const k of LOCAL_UI_SETTINGS_KEYS) {
      expect(syncedRaw).not.toHaveProperty(k);
    }
    expect(syncedRaw.theme).toBe("dark");
    // updatedAt is removed to prevent legacy timestamps from blocking LWW merges
    expect(syncedRaw.updatedAt).toBeUndefined();

    const localRaw = JSON.parse(localStorage.getItem(LOCAL_UI_STORAGE_KEY)!);
    expect(localRaw.fontSize).toBe(120);
    expect(localRaw.sidebarCollapsed).toBe(true);
    expect(localRaw.layoutMode).toBe("freeform");
    expect(localRaw.libraryView).toBe("table");
  });

  it("removes updatedAt timestamp during migration to prevent LWW conflicts", () => {
    // Simulate legacy case: fontSize change bumped updatedAt to 5000
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        theme: "light",
        colorTheme: "default",
        fontSize: 120,
        lineHeight: 1.8,
        updatedAt: 5000,
      }),
    );

    getSettings();

    const syncedRaw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    // After migration, updatedAt should be removed so remote synced settings
    // can be applied even if they have older timestamps
    expect(syncedRaw.updatedAt).toBeUndefined();
    expect(syncedRaw.theme).toBe("light");
    expect(syncedRaw.colorTheme).toBe("default");
    // UI fields should be in local bucket
    expect(syncedRaw.fontSize).toBeUndefined();
    expect(syncedRaw.lineHeight).toBeUndefined();
  });

  it("is idempotent when run twice", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: "dark", sidebarCollapsed: true }));
    getSettings();
    const after1 = {
      synced: localStorage.getItem(STORAGE_KEY),
      local: localStorage.getItem(LOCAL_UI_STORAGE_KEY),
    };
    getSettings();
    const after2 = {
      synced: localStorage.getItem(STORAGE_KEY),
      local: localStorage.getItem(LOCAL_UI_STORAGE_KEY),
    };
    expect(after1).toEqual(after2);
  });

  it("prefers existing local bucket values over legacy UI fields", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ theme: "dark", sidebarCollapsed: true, layoutMode: "freeform" }),
    );
    localStorage.setItem(LOCAL_UI_STORAGE_KEY, JSON.stringify({ sidebarCollapsed: false }));
    getSettings();
    const localRaw = JSON.parse(localStorage.getItem(LOCAL_UI_STORAGE_KEY)!);
    expect(localRaw.sidebarCollapsed).toBe(false);
    expect(localRaw.layoutMode).toBe("freeform");
    const syncedRaw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(syncedRaw).not.toHaveProperty("sidebarCollapsed");
    expect(syncedRaw).not.toHaveProperty("layoutMode");
  });
});

describe("normalizeLegacyFontSize (via getSettings)", () => {
  it("converts legacy pixel value 16 to percentage 100", () => {
    localStorage.setItem(LOCAL_UI_STORAGE_KEY, JSON.stringify({ fontSize: 16 }));
    expect(getSettings().fontSize).toBe(100);
  });

  it("converts legacy pixel value 20 to percentage 125", () => {
    localStorage.setItem(LOCAL_UI_STORAGE_KEY, JSON.stringify({ fontSize: 20 }));
    expect(getSettings().fontSize).toBe(125);
  });

  it("converts legacy pixel value 40 to percentage 250", () => {
    localStorage.setItem(LOCAL_UI_STORAGE_KEY, JSON.stringify({ fontSize: 40 }));
    expect(getSettings().fontSize).toBe(250);
  });

  it("preserves percentage-scale values above 40", () => {
    localStorage.setItem(LOCAL_UI_STORAGE_KEY, JSON.stringify({ fontSize: 150 }));
    expect(getSettings().fontSize).toBe(150);
  });

  it("returns default fontSize for NaN", () => {
    localStorage.setItem(LOCAL_UI_STORAGE_KEY, JSON.stringify({ fontSize: NaN }));
    expect(getSettings().fontSize).toBe(defaultSettings.fontSize);
  });

  it("returns default fontSize for non-number", () => {
    localStorage.setItem(LOCAL_UI_STORAGE_KEY, JSON.stringify({ fontSize: "big" }));
    expect(getSettings().fontSize).toBe(defaultSettings.fontSize);
  });
});

describe("saveSettings", () => {
  it("writes synced fields to the synced bucket and records a change", () => {
    saveSettings({ ...defaultSettings, theme: "dark", librarySortBy: "title" });
    const synced = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(synced.theme).toBe("dark");
    expect(synced.librarySortBy).toBe("title");
    expect(synced.updatedAt).toEqual(expect.any(Number));
    for (const k of LOCAL_UI_SETTINGS_KEYS) {
      expect(synced).not.toHaveProperty(k);
    }
    expect(recordChange).toHaveBeenCalledTimes(1);
    expect(recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "settings", entityId: "user-settings" }),
    );
  });

  it("writes local UI fields to the local bucket without recording a change", () => {
    saveSettings({ ...defaultSettings, sidebarCollapsed: true, layoutMode: "freeform" });
    const local = JSON.parse(localStorage.getItem(LOCAL_UI_STORAGE_KEY)!);
    expect(local.sidebarCollapsed).toBe(true);
    expect(local.layoutMode).toBe("freeform");
    for (const k of SYNCED_SETTINGS_KEYS) {
      expect(local).not.toHaveProperty(k);
    }
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(recordChange).not.toHaveBeenCalled();
  });

  it("records only once for a mixed synced+local update", () => {
    saveSettings({ ...defaultSettings, theme: "dark", sidebarCollapsed: true });
    expect(recordChange).toHaveBeenCalledTimes(1);
    const syncedArg = vi.mocked(recordChange).mock.calls[0][0].data as Record<string, unknown>;
    expect(syncedArg).not.toHaveProperty("sidebarCollapsed");
    expect(syncedArg.theme).toBe("dark");
  });

  it("does not stamp updatedAt when only local fields change", () => {
    saveSettings({ ...defaultSettings, theme: "dark" });
    const stampedFirst = JSON.parse(localStorage.getItem(STORAGE_KEY)!).updatedAt;
    vi.mocked(recordChange).mockClear();
    saveSettings({ ...defaultSettings, theme: "dark", sidebarCollapsed: true });
    const stampedSecond = JSON.parse(localStorage.getItem(STORAGE_KEY)!).updatedAt;
    expect(stampedSecond).toBe(stampedFirst);
    expect(recordChange).not.toHaveBeenCalled();
  });

  it("saves formatting preferences locally without syncing", () => {
    saveSettings({
      ...defaultSettings,
      fontSize: 120,
      fontFamily: "Georgia",
      lineHeight: 1.8,
    });

    // Verify they're stored in local bucket
    const localRaw = JSON.parse(localStorage.getItem(LOCAL_UI_STORAGE_KEY)!);
    expect(localRaw.fontSize).toBe(120);
    expect(localRaw.fontFamily).toBe("Georgia");
    expect(localRaw.lineHeight).toBe(1.8);

    // Verify they're NOT in synced bucket
    const syncedRaw = localStorage.getItem(STORAGE_KEY);
    expect(syncedRaw).toBeNull();

    // Verify no sync was triggered
    expect(recordChange).not.toHaveBeenCalled();
  });

  it("round-trips merged settings through getSettings", () => {
    saveSettings({
      ...defaultSettings,
      theme: "light",
      fontFamily: "Merriweather",
      fontSize: 110,
      sidebarCollapsed: true,
      layoutMode: "freeform",
    });
    const result = getSettings();
    expect(result.theme).toBe("light");
    expect(result.fontFamily).toBe("Merriweather");
    expect(result.fontSize).toBe(110);
    expect(result.sidebarCollapsed).toBe(true);
    expect(result.layoutMode).toBe("freeform");

    // Verify formatting preferences are stored locally, not synced
    const localRaw = JSON.parse(localStorage.getItem(LOCAL_UI_STORAGE_KEY)!);
    expect(localRaw.fontFamily).toBe("Merriweather");
    expect(localRaw.fontSize).toBe(110);

    const syncedRaw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(syncedRaw).not.toHaveProperty("fontFamily");
    expect(syncedRaw).not.toHaveProperty("fontSize");
    expect(syncedRaw).not.toHaveProperty("lineHeight");
  });
});

describe("resolveTheme", () => {
  it("returns 'light' when theme is 'light'", () => {
    expect(resolveTheme("light")).toBe("light");
  });

  it("returns 'dark' when theme is 'dark'", () => {
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("returns 'dark' when theme is 'system' and prefers-color-scheme is dark", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    expect(resolveTheme("system")).toBe("dark");
    vi.unstubAllGlobals();
  });

  it("returns 'light' when theme is 'system' and prefers-color-scheme is light", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    expect(resolveTheme("system")).toBe("light");
    vi.unstubAllGlobals();
  });
});

describe("focusedSplitRatio", () => {
  it("is included in the local bucket key list", () => {
    expect(LOCAL_UI_SETTINGS_KEYS).toContain("focusedSplitRatio");
    expect(SYNCED_SETTINGS_KEYS as readonly string[]).not.toContain("focusedSplitRatio");
  });

  it("defaults to FOCUSED_SPLIT_RATIO_DEFAULT when nothing is stored", () => {
    expect(getSettings().focusedSplitRatio).toBe(FOCUSED_SPLIT_RATIO_DEFAULT);
  });

  it("clampFocusedSplitRatio enforces bounds and falls back on non-finite values", () => {
    expect(clampFocusedSplitRatio(0)).toBe(FOCUSED_SPLIT_RATIO_MIN);
    expect(clampFocusedSplitRatio(0.1)).toBe(FOCUSED_SPLIT_RATIO_MIN);
    expect(clampFocusedSplitRatio(0.5)).toBe(0.5);
    expect(clampFocusedSplitRatio(0.99)).toBe(FOCUSED_SPLIT_RATIO_MAX);
    expect(clampFocusedSplitRatio(NaN)).toBe(FOCUSED_SPLIT_RATIO_DEFAULT);
    expect(clampFocusedSplitRatio(Infinity)).toBe(FOCUSED_SPLIT_RATIO_DEFAULT);
  });

  it("clamps an out-of-range stored value on read", () => {
    localStorage.setItem(LOCAL_UI_STORAGE_KEY, JSON.stringify({ focusedSplitRatio: 0.05 }));
    expect(getSettings().focusedSplitRatio).toBe(FOCUSED_SPLIT_RATIO_MIN);
    localStorage.setItem(LOCAL_UI_STORAGE_KEY, JSON.stringify({ focusedSplitRatio: 0.95 }));
    expect(getSettings().focusedSplitRatio).toBe(FOCUSED_SPLIT_RATIO_MAX);
  });

  it("persists to the local bucket without recording a sync change", () => {
    saveSettings({ ...defaultSettings, focusedSplitRatio: 0.65 });
    const local = JSON.parse(localStorage.getItem(LOCAL_UI_STORAGE_KEY)!);
    expect(local.focusedSplitRatio).toBe(0.65);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(recordChange).not.toHaveBeenCalled();
  });

  it("clamps an out-of-range value on write", () => {
    saveSettings({ ...defaultSettings, focusedSplitRatio: 0.99 });
    const local = JSON.parse(localStorage.getItem(LOCAL_UI_STORAGE_KEY)!);
    expect(local.focusedSplitRatio).toBe(FOCUSED_SPLIT_RATIO_MAX);
  });

  it("round-trips a valid value through saveSettings → getSettings", () => {
    saveSettings({ ...defaultSettings, focusedSplitRatio: 0.6 });
    expect(getSettings().focusedSplitRatio).toBe(0.6);
  });
});
