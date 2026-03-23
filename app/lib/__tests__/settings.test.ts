import { describe, it, expect, beforeEach, vi } from "vitest";
import { getSettings, saveSettings, resolveTheme } from "../settings";
import type { Settings } from "../settings";

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

beforeEach(() => {
  localStorage.clear();
});

describe("getSettings", () => {
  it("returns default settings when localStorage is empty", () => {
    expect(getSettings()).toEqual(defaultSettings);
  });

  it("returns stored settings when valid JSON exists", () => {
    const stored: Settings = {
      theme: "dark",
      readerLayout: "spread",
      fontFamily: "Georgia",
      fontSize: 120,
      lineHeight: 1.8,
      sidebarCollapsed: true,
      workspaceSortBy: "title",
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    expect(getSettings()).toEqual(stored);
  });

  it("merges partial stored settings with defaults", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: "dark" }));
    expect(getSettings()).toEqual({ ...defaultSettings, theme: "dark" });
  });

  it("returns defaults when localStorage contains corrupt JSON", () => {
    localStorage.setItem(STORAGE_KEY, "not-valid-json{{{");
    expect(getSettings()).toEqual(defaultSettings);
  });

  it("returns defaults when localStorage contains empty string", () => {
    localStorage.setItem(STORAGE_KEY, "");
    // JSON.parse("") throws, so we get defaults
    expect(getSettings()).toEqual(defaultSettings);
  });
});

describe("normalizeLegacyFontSize (via getSettings)", () => {
  it("converts legacy pixel value 16 to percentage 100", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fontSize: 16 }));
    expect(getSettings().fontSize).toBe(100);
  });

  it("converts legacy pixel value 20 to percentage 125", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fontSize: 20 }));
    expect(getSettings().fontSize).toBe(125);
  });

  it("converts legacy pixel value 24 to percentage 150", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fontSize: 24 }));
    expect(getSettings().fontSize).toBe(150);
  });

  it("converts legacy pixel value 40 to percentage 250", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fontSize: 40 }));
    expect(getSettings().fontSize).toBe(250);
  });

  it("preserves percentage-scale values above 40", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fontSize: 100 }));
    expect(getSettings().fontSize).toBe(100);
  });

  it("preserves percentage-scale value 150", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fontSize: 150 }));
    expect(getSettings().fontSize).toBe(150);
  });

  it("returns default fontSize for NaN", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fontSize: NaN }));
    expect(getSettings().fontSize).toBe(defaultSettings.fontSize);
  });

  it("returns default fontSize for non-number", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fontSize: "big" }));
    expect(getSettings().fontSize).toBe(defaultSettings.fontSize);
  });
});

describe("saveSettings", () => {
  it("persists settings to localStorage", () => {
    const settings: Settings = { ...defaultSettings, theme: "dark" };
    saveSettings(settings);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual(settings);
  });

  it("round-trips with getSettings", () => {
    const settings: Settings = {
      theme: "light",
      readerLayout: "scroll",
      fontFamily: "Merriweather",
      fontSize: 110,
      lineHeight: 1.4,
      sidebarCollapsed: true,
      workspaceSortBy: "author",
    };
    saveSettings(settings);
    expect(getSettings()).toEqual(settings);
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
