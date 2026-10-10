import { describe, expect, it } from "vitest";
import { getBookPreferences, saveBookPreferences } from "~/lib/stores/book-preferences-store";

describe("book preferences", () => {
  it("keeps unrelated defaults absent when saving a single override", async () => {
    await saveBookPreferences("sparse-book", { fontSize: 120 });

    await expect(getBookPreferences("sparse-book")).resolves.toEqual({ fontSize: 120 });
  });

  it("preserves independent overrides when edits overlap", async () => {
    await Promise.all([
      saveBookPreferences("overlapping-book", { readerLayout: "scroll" }),
      saveBookPreferences("overlapping-book", { fontSize: 125 }),
    ]);

    await expect(getBookPreferences("overlapping-book")).resolves.toEqual({
      readerLayout: "scroll",
      fontSize: 125,
    });
  });

  it("preserves an explicit publisher text alignment choice", async () => {
    await saveBookPreferences("alignment-book", { textAlign: "justify" });
    await saveBookPreferences("alignment-book", { textAlign: undefined });
    await saveBookPreferences("alignment-book", { readerLayout: "single" });

    const preferences = await getBookPreferences("alignment-book");
    expect(preferences).toHaveProperty("textAlign", undefined);
    expect(preferences?.readerLayout).toBe("single");
  });

  it("persists and reloads font weight with typography preferences", async () => {
    await saveBookPreferences("font-weight-book", {
      fontFamily: "Literata",
      fontSize: 110,
      fontWeight: 600,
      lineHeight: 1.7,
    });

    await expect(getBookPreferences("font-weight-book")).resolves.toEqual({
      fontFamily: "Literata",
      fontSize: 110,
      fontWeight: 600,
      lineHeight: 1.7,
    });
  });
});
