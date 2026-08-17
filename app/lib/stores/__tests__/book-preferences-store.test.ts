import { describe, expect, it } from "vitest";
import { getBookPreferences, saveBookPreferences } from "~/lib/stores/book-preferences-store";

describe("book preferences", () => {
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
