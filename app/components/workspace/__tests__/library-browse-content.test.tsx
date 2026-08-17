import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookMeta } from "~/lib/stores/book-store";

vi.mock("~/hooks/use-effect-query", () => ({
  useEffectQuery: () => ({ data: new Map(), error: undefined, isLoading: false }),
}));

import { LibraryBrowseContent } from "~/components/workspace/library-browse-content";
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

function renderLibrary(onOpenBook = vi.fn()) {
  function Harness() {
    const workspace = useWorkspace();
    workspace.booksRef.current = [book];
    return <LibraryBrowseContent onOpenBook={onOpenBook} />;
  }

  act(() => {
    root!.render(
      <MemoryRouter>
        <WorkspaceProvider>
          <Harness />
        </WorkspaceProvider>
      </MemoryRouter>,
    );
  });
  return onOpenBook;
}

describe("LibraryBrowseContent", () => {
  it("caps every library grid card while leaving the grid tracks available", () => {
    renderLibrary();

    const grid = container!.querySelector<HTMLElement>(".grid-cols-2")!;
    expect(grid.className).toContain("items-start");
    expect([...grid.children]).toHaveLength(3);
    expect([...grid.children].every((card) => card.classList.contains("max-w-40"))).toBe(true);
    expect(grid.querySelector('[aria-label="Open Test Book"] .aspect-\\[2\\/3\\]')).not.toBeNull();
  });

  it("keeps search, sort, and layout together in order and still opens a book", async () => {
    const onOpenBook = renderLibrary();
    const search = container!.querySelector<HTMLInputElement>('[aria-label="Search books"]')!;
    const toolbar = search.parentElement!.parentElement!;
    const controls = toolbar.children[1]!;

    expect(toolbar.className).not.toContain("justify-between");
    expect(toolbar.children[0]!.contains(search)).toBe(true);
    expect(controls.querySelector('[aria-label^="Sort library by"]')).not.toBeNull();
    expect(controls.querySelector('[aria-label="Grid view"]')).not.toBeNull();

    await act(async () =>
      container!.querySelector<HTMLButtonElement>('[aria-label="Open Test Book"]')!.click(),
    );
    expect(onOpenBook).toHaveBeenCalledWith(book);
  });
});
