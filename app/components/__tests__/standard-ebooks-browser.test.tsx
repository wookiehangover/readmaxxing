import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookMeta } from "~/lib/stores/book-store";

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), runPromise: vi.fn() }));

const queryResult = vi.hoisted(() => ({
  data: {
    books: [
      {
        title: "Book One",
        author: "Author One",
        urlPath: "/ebooks/book-one",
        coverUrl: null,
      },
      {
        title: "Book Two",
        author: "Author Two",
        urlPath: "/ebooks/book-two",
        coverUrl: null,
      },
    ],
    currentPage: 1,
    totalPages: 1,
  },
  error: undefined,
  isLoading: false,
}));

vi.mock("~/hooks/use-effect-query", () => ({
  useEffectQuery: () => queryResult,
}));

vi.mock("~/lib/effect-runtime", () => ({
  AppRuntime: { runPromise: mocks.runPromise },
}));

vi.mock("~/lib/themis/provider", () => ({
  useAppStore: () => ({
    dispatch: mocks.dispatch,
    booksSelectors: { selectAllBooks: { useValue: () => [] } },
  }),
}));

vi.mock("~/components/bug-report-dialog", () => ({
  BugReportDialog: () => null,
}));

import { StandardEbooksBrowser } from "~/components/standard-ebooks-browser";
import { LibraryFrame } from "~/components/workspace/library-frame";
import { uploadBooksRequested } from "~/lib/themis/books/books-slice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | undefined;
let root: Root | undefined;

beforeEach(() => {
  localStorage.clear();
  mocks.dispatch.mockReset();
  mocks.runPromise.mockReset();
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("StandardEbooksBrowser", () => {
  it("keeps loaded books when switching from the library-style grid to the table", async () => {
    await act(async () => {
      root!.render(
        <MemoryRouter>
          <LibraryFrame fileInputRef={createRef<HTMLInputElement>()} onFileInput={vi.fn()}>
            <StandardEbooksBrowser onBookAdded={vi.fn()} />
          </LibraryFrame>
        </MemoryRouter>,
      );
    });

    const grid = container!.querySelector<HTMLElement>(".grid");
    expect(grid?.classList.contains("max-w-6xl")).toBe(true);
    expect(grid?.classList.contains("grid-cols-[repeat(auto-fill,minmax(10rem,10rem))]")).toBe(
      true,
    );
    expect(grid?.className).toContain("sm:gap-6");
    expect(grid?.className).toContain("items-start");
    expect([...grid!.children].every((card) => card.classList.contains("max-w-40"))).toBe(true);
    expect(grid?.querySelectorAll('a[href^="https://standardebooks.org/ebooks/"]')).toHaveLength(2);

    const search = container!.querySelector<HTMLInputElement>(
      '[aria-label="Search Standard Ebooks"]',
    )!;
    const toolbar = search.parentElement!.parentElement!;
    expect(container!.querySelector("header")?.contains(toolbar)).toBe(true);
    expect(toolbar.className).not.toContain("pt-4");
    expect(toolbar.className).not.toContain("pb-2");
    expect(toolbar.className).not.toContain("justify-between");
    expect(toolbar.children[0]!.contains(search)).toBe(true);
    expect(toolbar.children[1]!.querySelector('[aria-label="Grid view"]')).not.toBeNull();

    const tableToggle = container!.querySelector<HTMLButtonElement>(
      'button[aria-label="Table view"]',
    )!;
    await act(async () => {
      tableToggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(grid?.classList.contains("grid")).toBe(false);
    expect(container!.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(container!.querySelector("table")?.closest(".max-w-6xl")).not.toBeNull();
  });

  it("downloads an EPUB then dispatches it through the shared upload saga", async () => {
    const data = new ArrayBuffer(8);
    const onBookAdded = vi.fn();
    mocks.runPromise.mockResolvedValueOnce(data);
    await act(async () => {
      root!.render(
        <MemoryRouter>
          <LibraryFrame fileInputRef={createRef<HTMLInputElement>()} onFileInput={vi.fn()}>
            <StandardEbooksBrowser onBookAdded={onBookAdded} />
          </LibraryFrame>
        </MemoryRouter>,
      );
    });

    const addButton = [...container!.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Add to Library"),
    )!;
    await act(async () => {
      addButton.click();
      await Promise.resolve();
    });

    expect(mocks.runPromise).toHaveBeenCalledOnce();
    expect(mocks.dispatch).toHaveBeenCalledOnce();
    const action = mocks.dispatch.mock.calls[0]![0] as ReturnType<typeof uploadBooksRequested>;
    const [files, onUploaded] = action.payload;
    expect(files[0]?.name).toBe("Book One.epub");
    await expect(files[0]?.arrayBuffer()).resolves.toBe(data);

    const savedBook: BookMeta = {
      id: "saved",
      title: "Book One",
      author: "Author One",
      coverImage: null,
      format: "epub",
    };
    act(() => onUploaded?.(savedBook));
    expect(onBookAdded).toHaveBeenCalledWith(savedBook);
    expect(addButton.textContent).toContain("Added");
  });

  it("settles the importing state when the upload saga reports a parse failure", async () => {
    mocks.runPromise.mockResolvedValueOnce(new ArrayBuffer(8));
    await act(async () => {
      root!.render(
        <MemoryRouter>
          <LibraryFrame fileInputRef={createRef<HTMLInputElement>()} onFileInput={vi.fn()}>
            <StandardEbooksBrowser onBookAdded={vi.fn()} />
          </LibraryFrame>
        </MemoryRouter>,
      );
    });

    const addButton = [...container!.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Add to Library"),
    )!;
    await act(async () => {
      addButton.click();
      await Promise.resolve();
    });
    const action = mocks.dispatch.mock.calls[0]![0] as ReturnType<typeof uploadBooksRequested>;
    act(() => action.payload[3]?.("parse failed"));

    expect(container!.textContent).toContain('Failed to import "Book One". Please try again.');
    expect(addButton.textContent).toContain("Add to Library");
    expect(addButton.disabled).toBe(false);
  });
});
