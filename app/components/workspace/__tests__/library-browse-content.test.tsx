import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookMeta } from "~/lib/stores/book-store";

vi.mock("~/hooks/use-effect-query", () => ({
  useEffectQuery: () => ({ data: new Map(), error: undefined, isLoading: false }),
}));

import { LibraryBrowseContent } from "~/components/workspace/library-browse-content";
import { LibraryFrame } from "~/components/workspace/library-frame";
import { useWorkspace, WorkspaceProvider } from "~/lib/context/workspace-context";

const book: BookMeta = {
  id: "book-1",
  title: "Test Book",
  author: "Test Author",
  coverImage: null,
  format: "epub",
};

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
  container = undefined;
  root = undefined;
});

function renderLibrary(onOpenBook = vi.fn(), books: BookMeta[] = [book]) {
  function Harness() {
    const workspace = useWorkspace();
    workspace.booksRef.current = books;
    return <LibraryBrowseContent onOpenBook={onOpenBook} />;
  }

  act(() => {
    root!.render(
      <MemoryRouter>
        <WorkspaceProvider>
          <LibraryFrame fileInputRef={createRef<HTMLInputElement>()} onFileInput={vi.fn()}>
            <Harness />
          </LibraryFrame>
        </WorkspaceProvider>
      </MemoryRouter>,
    );
  });
  return onOpenBook;
}

describe("LibraryBrowseContent", () => {
  it("caps the library grid and keeps its tracks cover-sized", () => {
    renderLibrary();

    const grid = container!.querySelector<HTMLElement>(".grid")!;
    expect(grid.classList.contains("max-w-6xl")).toBe(true);
    expect(grid.classList.contains("grid-cols-2")).toBe(true);
    expect(grid.classList.contains("sm:grid-cols-[repeat(auto-fill,minmax(10rem,10rem))]")).toBe(
      true,
    );
    expect(grid.className).toContain("items-start");
    expect([...grid.children]).toHaveLength(3);
    expect([...grid.children].every((card) => card.classList.contains("max-w-40"))).toBe(true);
    expect(grid.querySelector('[aria-label="Open Test Book"] .aspect-\\[2\\/3\\]')).not.toBeNull();
  });

  it("uses the same content cap for the table view", async () => {
    renderLibrary();

    await act(async () =>
      container!.querySelector<HTMLButtonElement>('button[aria-label="Table view"]')!.click(),
    );

    expect(container!.querySelector("table")?.closest(".max-w-6xl")).not.toBeNull();
    expect(container!.querySelector("table")?.className).toContain("table-fixed");
  });

  it("keeps search, sort, and layout together in order and still opens a book", async () => {
    const onOpenBook = renderLibrary();
    const search = container!.querySelector<HTMLInputElement>('[aria-label="Search books"]')!;
    const toolbar = search.parentElement!.parentElement!;
    const controls = toolbar.children[1]!;
    const header = container!.querySelector("header")!;

    expect(header.contains(toolbar)).toBe(true);
    expect(toolbar.className).not.toContain("pt-4");
    expect(toolbar.className).not.toContain("pb-2");
    expect(toolbar.className).not.toContain("justify-between");
    expect(toolbar.children[0]!.contains(search)).toBe(true);
    expect(controls.querySelector('[aria-label^="Sort library by"]')).not.toBeNull();
    expect(controls.querySelector('[aria-label="Grid view"]')).not.toBeNull();

    await act(async () =>
      container!.querySelector<HTMLButtonElement>('[aria-label="Open Test Book"]')!.click(),
    );
    expect(onOpenBook).toHaveBeenCalledWith(book);
  });

  it("leaves the header without a control cluster when the library is empty", () => {
    renderLibrary(vi.fn(), []);

    const header = container!.querySelector("header")!;
    expect(header.querySelector('[aria-label="Search books"]')).toBeNull();
    expect(header.querySelector('nav[aria-label="Library navigation"]')).not.toBeNull();
  });
});
