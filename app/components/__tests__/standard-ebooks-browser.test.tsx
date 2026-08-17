import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { StandardEbooksBrowser } from "~/components/standard-ebooks-browser";

let container: HTMLDivElement | undefined;
let root: Root | undefined;

beforeEach(() => {
  localStorage.clear();
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
      root!.render(<StandardEbooksBrowser onBookAdded={vi.fn()} />);
    });

    const grid = container!.querySelector<HTMLElement>(".grid-cols-2");
    expect(grid?.className).toContain("sm:gap-6");
    expect(grid?.className).toContain("xl:grid-cols-6");
    expect(grid?.className).toContain("items-start");
    expect([...grid!.children].every((card) => card.classList.contains("max-w-40"))).toBe(true);
    expect(grid?.querySelectorAll('a[href^="https://standardebooks.org/ebooks/"]')).toHaveLength(2);

    const search = container!.querySelector<HTMLInputElement>(
      '[aria-label="Search Standard Ebooks"]',
    )!;
    const toolbar = search.parentElement!.parentElement!;
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

    expect(container!.querySelector(".grid-cols-2")).toBeNull();
    expect(container!.querySelectorAll("tbody tr")).toHaveLength(2);
  });
});
