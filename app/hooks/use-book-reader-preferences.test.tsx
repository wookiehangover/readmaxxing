import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBookReaderPreferences } from "~/hooks/use-book-reader-preferences";
import { getSettings, type Settings } from "~/lib/settings";
import * as preferencesStore from "~/lib/stores/book-preferences-store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let current: ReturnType<typeof useBookReaderPreferences>;
let settings: Settings;
let bookId: string;
const renditionRef = { current: null };
const navigationRef = { current: null };

function Harness() {
  current = useBookReaderPreferences({ bookId, settings, renditionRef, navigationRef });
  return null;
}

async function renderPreferences() {
  await act(async () => root.render(<Harness />));
  // Wait for the reader's IndexedDB load, then flush its resulting state updates.
  await act(async () => {
    await preferencesStore.getBookPreferences(bookId);
  });
}

function expectSettings(expected: Partial<Settings>) {
  expect(current.localSettings).toMatchObject(expected);
}

async function updatePreferences(update: Partial<Settings>) {
  const save = vi.spyOn(preferencesStore, "saveBookPreferences");
  await act(async () => {
    current.onUpdateSettings(update);
    await save.mock.results.at(-1)?.value;
  });
  save.mockRestore();
}

beforeEach(() => {
  window.localStorage.clear();
  settings = { ...getSettings(), readerLayout: "scroll" };
  bookId = crypto.randomUUID();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("book reader preference inheritance", () => {
  it("uses defaults without creating overrides when a book is opened", async () => {
    await renderPreferences();
    await expectSettings({ readerLayout: "scroll", fontFamily: "Literata" });

    await expect(preferencesStore.getBookPreferences(bookId)).resolves.toBeUndefined();

    settings = { ...settings, readerLayout: "single", fontSize: 125 };
    await renderPreferences();
    await expectSettings({ readerLayout: "single", fontSize: 125 });
  });

  it("keeps layout inherited after a font edit and reopening the book", async () => {
    await renderPreferences();
    await updatePreferences({ fontSize: 120 });

    await expect(preferencesStore.getBookPreferences(bookId)).resolves.toEqual({ fontSize: 120 });

    await act(async () => root.render(null));
    settings = { ...settings, readerLayout: "single", fontSize: 140, lineHeight: 1.9 };
    await renderPreferences();
    await expectSettings({ readerLayout: "single", fontSize: 120, lineHeight: 1.9 });
  });

  it("preserves an explicit layout while unrelated settings follow new defaults", async () => {
    await renderPreferences();
    await updatePreferences({ readerLayout: "spread" });
    await updatePreferences({ fontWeight: 600 });

    await expect(preferencesStore.getBookPreferences(bookId)).resolves.toEqual({
      readerLayout: "spread",
      fontWeight: 600,
    });

    settings = { ...settings, readerLayout: "single", fontSize: 135, fontWeight: 300 };
    await renderPreferences();
    await expectSettings({ readerLayout: "spread", fontSize: 135, fontWeight: 600 });

    bookId = crypto.randomUUID();
    await renderPreferences();
    await expectSettings({ readerLayout: "single", fontSize: 135, fontWeight: 300 });
  });

  it("treats choosing the current default as an explicit book override", async () => {
    await renderPreferences();
    await updatePreferences({ readerLayout: "scroll" });

    settings = { ...settings, readerLayout: "spread" };
    await renderPreferences();
    await expectSettings({ readerLayout: "scroll" });
    await expect(preferencesStore.getBookPreferences(bookId)).resolves.toEqual({
      readerLayout: "scroll",
    });
  });
});
