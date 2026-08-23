import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookMeta } from "~/lib/stores/book-store";

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), runPromise: vi.fn() }));

const queryResult = vi.hoisted(() => ({
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
}));

vi.mock("~/lib/standard-ebooks", () => ({
  StandardEbooksService: {
    searchBooks: vi.fn().mockResolvedValue(queryResult),
    downloadEpub: mocks.runPromise,
  },
}));

vi.mock("~/lib/themis/provider", () => ({
  useAppStore: () => ({
    dispatch: mocks.dispatch,
    booksSelectors: { selectAllBooks: { useValue: () => [] } },
    workspaceRestoreSelectors: { selectLastOpenedMap: { useValue: () => new Map() } },
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
  async function renderBrowser(onBookAdded = vi.fn()) {
    await act(async () => {
      root!.render(
        <MemoryRouter>
          <LibraryFrame fileInputRef={createRef<HTMLInputElement>()} onFileInput={vi.fn()}>
            <StandardEbooksBrowser onBookAdded={onBookAdded} />
          </LibraryFrame>
        </MemoryRouter>,
      );
    });
  }

  it("uses the library wrap layout and keeps loaded books when switching to the table", async () => {
    await renderBrowser();

    const wrap = [...container!.querySelectorAll<HTMLElement>("div")].find(
      (element) => element.classList.contains("flex-wrap") && element.classList.contains("gap-8"),
    );
    expect(wrap?.classList.contains("justify-center")).toBe(true);
    expect(wrap?.classList.contains("md:justify-start")).toBe(true);
    expect(wrap?.classList.contains("grid")).toBe(false);
    expect(wrap?.classList.contains("max-w-6xl")).toBe(false);
    expect([...wrap!.children]).toHaveLength(2);
    expect(
      [...wrap!.children].every(
        (card) => card.classList.contains("max-w-40") && card.classList.contains("md:max-w-52"),
      ),
    ).toBe(true);
    expect(wrap!.querySelectorAll('a[href^="https://standardebooks.org/ebooks/"]')).toHaveLength(0);
    expect(wrap!.textContent).not.toContain("Book One");
    expect(wrap!.textContent).not.toContain("Author One");

    const firstCover = wrap!.querySelector<HTMLButtonElement>(
      'button[aria-label="Add Book One to library"]',
    )!;
    const coverContainer = firstCover.firstElementChild!;
    expect(coverContainer.classList.contains("shadow-lg")).toBe(true);
    expect(coverContainer.classList.contains("group-hover:shadow-2xl")).toBe(true);
    expect(coverContainer.classList.contains("book-cover-container")).toBe(true);
    expect(firstCover.querySelector(".aspect-\\[2\\/3\\]")).not.toBeNull();

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

    expect(container!.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(container!.querySelector("table")?.closest(".max-w-6xl")).not.toBeNull();
    expect(container!.querySelector("table")?.className).toContain("table-fixed");
  });

  it("imports from a cover click and prevents the added book from importing again", async () => {
    const data = new ArrayBuffer(8);
    const onBookAdded = vi.fn();
    mocks.runPromise.mockResolvedValueOnce(data);
    await renderBrowser(onBookAdded);

    const coverButton = container!.querySelector<HTMLButtonElement>(
      'button[aria-label="Add Book One to library"]',
    )!;
    await act(async () => {
      coverButton.click();
      await Promise.resolve();
    });

    expect(mocks.runPromise).toHaveBeenCalledWith("/ebooks/book-one");
    expect(mocks.dispatch).toHaveBeenCalledOnce();
    expect(coverButton.getAttribute("aria-label")).toBe("Importing Book One");
    expect(coverButton.querySelector(".animate-spin")).not.toBeNull();
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
    expect(coverButton.getAttribute("aria-label")).toBe("Book One added to library");
    expect(coverButton.disabled).toBe(true);
    coverButton.click();
    expect(mocks.runPromise).toHaveBeenCalledOnce();
    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });

  it("offers the Standard Ebooks link and add action in the cover menu", async () => {
    mocks.runPromise.mockResolvedValueOnce(new ArrayBuffer(8));
    await renderBrowser();

    const trigger = container!.querySelector<HTMLButtonElement>(
      'button[aria-label="Actions for Book One"]',
    )!;
    expect(trigger.classList.contains("opacity-20")).toBe(true);
    expect(trigger.classList.contains("group-hover:opacity-100")).toBe(true);
    await act(async () => trigger.click());

    const menuItems = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const externalLink = menuItems.find((item) =>
      item.textContent?.includes("View on Standard Ebooks"),
    ) as HTMLAnchorElement;
    expect(externalLink.href).toBe("https://standardebooks.org/ebooks/book-one");
    expect(externalLink.target).toBe("_blank");
    expect(externalLink.rel).toBe("noopener noreferrer");

    const addItem = menuItems.find((item) => item.textContent?.includes("Add to library"))!;
    await act(async () => {
      addItem.click();
      await Promise.resolve();
    });
    expect(mocks.runPromise).toHaveBeenCalledWith("/ebooks/book-one");
    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });

  it("settles the importing state when the upload saga reports a parse failure", async () => {
    mocks.runPromise.mockResolvedValueOnce(new ArrayBuffer(8));
    await renderBrowser();

    const coverButton = container!.querySelector<HTMLButtonElement>(
      'button[aria-label="Add Book One to library"]',
    )!;
    await act(async () => {
      coverButton.click();
      await Promise.resolve();
    });
    const action = mocks.dispatch.mock.calls[0]![0] as ReturnType<typeof uploadBooksRequested>;
    act(() => action.payload[3]?.("parse failed"));

    expect(container!.textContent).toContain('Failed to import "Book One". Please try again.');
    expect(coverButton.getAttribute("aria-label")).toBe("Add Book One to library");
    expect(coverButton.disabled).toBe(false);
  });
});
