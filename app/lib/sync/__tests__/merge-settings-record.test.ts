import { beforeEach, describe, expect, it } from "vitest";
import { mergeSettingsRecord } from "../entity-mergers";

const SYNCED_KEY = "app-settings";
const LOCAL_UI_KEY = "app-ui-settings";

beforeEach(() => {
  localStorage.clear();
});

describe("mergeSettingsRecord — synced-key filtering", () => {
  it("drops UI/layout fields from a remote payload and only persists synced keys", async () => {
    await mergeSettingsRecord({
      settings: {
        theme: "dark",
        fontSize: 120,
        // UI/layout fields that older clients may have written into the
        // server blob — these must never reach localStorage.
        layoutMode: "freeform",
        sidebarCollapsed: true,
        libraryView: "table",
        readerLayout: "spread",
        pdfLayout: "two-page",
        workspaceSortBy: "title",
      },
      updatedAt: 1000,
    });

    const synced = JSON.parse(localStorage.getItem(SYNCED_KEY)!);
    expect(synced).toEqual({ theme: "dark", updatedAt: 1000 });
    expect(synced).not.toHaveProperty("fontSize");
    expect(synced).not.toHaveProperty("layoutMode");
    expect(synced).not.toHaveProperty("sidebarCollapsed");
    expect(synced).not.toHaveProperty("libraryView");
    expect(synced).not.toHaveProperty("readerLayout");
    expect(synced).not.toHaveProperty("pdfLayout");
    expect(synced).not.toHaveProperty("workspaceSortBy");
  });

  it("never reads or writes the local UI bucket", async () => {
    localStorage.setItem(
      LOCAL_UI_KEY,
      JSON.stringify({ layoutMode: "freeform", sidebarCollapsed: true, libraryView: "table" }),
    );

    await mergeSettingsRecord({
      settings: {
        theme: "dark",
        // Server blob also carries stale UI fields — must be ignored.
        layoutMode: "focused",
        sidebarCollapsed: false,
      },
      updatedAt: 5000,
    });

    const localUI = JSON.parse(localStorage.getItem(LOCAL_UI_KEY)!);
    expect(localUI).toEqual({
      layoutMode: "freeform",
      sidebarCollapsed: true,
      libraryView: "table",
    });
  });

  it("applies LWW: newer remote wins for synced fields", async () => {
    localStorage.setItem(
      SYNCED_KEY,
      JSON.stringify({ theme: "light", colorTheme: "default", updatedAt: 100 }),
    );

    await mergeSettingsRecord({
      settings: { theme: "dark", colorTheme: "nord" },
      updatedAt: 200,
    });

    const synced = JSON.parse(localStorage.getItem(SYNCED_KEY)!);
    expect(synced.theme).toBe("dark");
    expect(synced.colorTheme).toBe("nord");
    expect(synced.updatedAt).toBe(200);
  });

  it("applies LWW: older remote is ignored", async () => {
    localStorage.setItem(
      SYNCED_KEY,
      JSON.stringify({ theme: "dark", colorTheme: "nord", updatedAt: 500 }),
    );

    await mergeSettingsRecord({
      settings: { theme: "light", colorTheme: "default", fontSize: 100, layoutMode: "freeform" },
      updatedAt: 100,
    });

    const synced = JSON.parse(localStorage.getItem(SYNCED_KEY)!);
    expect(synced).toEqual({ theme: "dark", colorTheme: "nord", updatedAt: 500 });
  });

  it("returns silently when remote payload has no settings field", async () => {
    await mergeSettingsRecord({ updatedAt: 1000 });
    expect(localStorage.getItem(SYNCED_KEY)).toBeNull();
    expect(localStorage.getItem(LOCAL_UI_KEY)).toBeNull();
  });

  it("writes nothing observable from UI keys when remote carries only UI fields", async () => {
    await mergeSettingsRecord({
      settings: { layoutMode: "freeform", sidebarCollapsed: true },
      updatedAt: 1000,
    });

    const synced = JSON.parse(localStorage.getItem(SYNCED_KEY)!);
    // Only updatedAt is written; no UI keys leak in.
    expect(synced).toEqual({ updatedAt: 1000 });
    expect(localStorage.getItem(LOCAL_UI_KEY)).toBeNull();
  });
});
