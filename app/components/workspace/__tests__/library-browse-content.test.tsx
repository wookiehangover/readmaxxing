import { act, createRef, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookMeta } from "~/lib/stores/book-store";

const themisMocks = vi.hoisted(() => ({
  books: [] as BookMeta[],
  lastOpenedMap: new Map<string, number>(),
  dispatch: vi.fn(),
}));

vi.mock("~/lib/themis/provider", () => ({
  useAppStore: () => ({
    dispatch: themisMocks.dispatch,
    state: { books: { downloadingBookIds: [] } },
    booksSelectors: {
      selectAllBooks: { useValue: () => themisMocks.books },
      selectDownloadingBookIds: { useValue: () => [] },
    },
    workspaceRestoreSelectors: {
      selectLastOpenedMap: { useValue: () => themisMocks.lastOpenedMap },
    },
  }),
}));

import { LibraryBrowseContent } from "~/components/workspace/library-browse-content";
import { LibraryFrame } from "~/components/workspace/library-frame";
import { useWorkspace, WorkspaceProvider } from "~/lib/context/workspace-context";
import { downloadBookForOpenRequested } from "~/lib/themis/books/books-slice";

const book: BookMeta = {
  id: "book-1",
  title: "Test Book",
  author: "Test Author",
  coverImage: null,
  format: "epub",
};

let container: HTMLDivElement | undefined;
let root: Root | undefined;

interface WorkspaceBookActions {
  onOpenNotebook?: (book: BookMeta) => void;
  onOpenChat?: (book: BookMeta) => void;
}

function WorkspaceBookActionRefs({ onOpenNotebook, onOpenChat }: WorkspaceBookActions) {
  const workspace = useWorkspace();

  useEffect(() => {
    workspace.openNotebookRef.current = onOpenNotebook ?? null;
    workspace.openChatRef.current = onOpenChat ?? null;
    return () => {
      workspace.openNotebookRef.current = null;
      workspace.openChatRef.current = null;
    };
  }, [onOpenChat, onOpenNotebook, workspace]);

  return null;
}

beforeEach(() => {
  localStorage.clear();
  themisMocks.books = [];
  themisMocks.lastOpenedMap = new Map();
  themisMocks.dispatch.mockReset();
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

function renderLibrary(
  onOpenBook = vi.fn(),
  books: BookMeta[] = [book],
  actions: WorkspaceBookActions = {},
) {
  themisMocks.books = books;

  act(() => {
    root!.render(
      <MemoryRouter>
        <WorkspaceProvider>
          <WorkspaceBookActionRefs {...actions} />
          <LibraryFrame fileInputRef={createRef<HTMLInputElement>()} onFileInput={vi.fn()}>
            <LibraryBrowseContent onOpenBook={onOpenBook} />
          </LibraryFrame>
        </WorkspaceProvider>
      </MemoryRouter>,
    );
  });
  return onOpenBook;
}

async function selectBookAction(label: string) {
  const bookCard = container!
    .querySelector<HTMLButtonElement>('[aria-label="Open Test Book"]')!
    .closest(".group")!;
  const menuTrigger = bookCard.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;

  await act(async () => menuTrigger.click());

  const menuItem = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
    item.textContent?.includes(label),
  );
  expect(menuItem).toBeDefined();

  await act(async () => menuItem!.click());
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

    const tableWrapper = container!.querySelector("table")?.closest(".max-w-6xl");
    expect(tableWrapper).not.toBeNull();
    expect(tableWrapper!.classList.contains("mx-auto")).toBe(true);
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

  it.each([
    ["Open notebook", "onOpenNotebook"],
    ["Open chat", "onOpenChat"],
  ] as const)("downloads a synced book before the %s action", async (label, actionName) => {
    const remoteBook = {
      ...book,
      remoteFileUrl: "https://example.com/book.epub",
      hasLocalFile: false,
    };
    const downloadedBook = { ...remoteBook, hasLocalFile: true };
    const openReadingTool = vi.fn();
    themisMocks.dispatch.mockImplementation(
      (action: ReturnType<typeof downloadBookForOpenRequested>) => {
        expect(openReadingTool).not.toHaveBeenCalled();
        void action.payload[1](downloadedBook);
        return action;
      },
    );
    const onOpenBook = renderLibrary(vi.fn(), [remoteBook], { [actionName]: openReadingTool });

    await selectBookAction(label);

    expect(themisMocks.dispatch).toHaveBeenCalledOnce();
    expect(themisMocks.dispatch.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        type: downloadBookForOpenRequested.type,
        payload: [book.id, expect.any(Function), expect.any(Function)],
      }),
    );
    expect(openReadingTool).toHaveBeenCalledExactlyOnceWith(downloadedBook);
    expect(onOpenBook).not.toHaveBeenCalled();
  });

  it.each([
    ["Open notebook", "onOpenNotebook"],
    ["Open chat", "onOpenChat"],
  ] as const)(
    "opens an already-local book directly for the %s action",
    async (label, actionName) => {
      const openReadingTool = vi.fn();
      const onOpenBook = renderLibrary(vi.fn(), [book], { [actionName]: openReadingTool });

      await selectBookAction(label);

      expect(themisMocks.dispatch).not.toHaveBeenCalled();
      expect(openReadingTool).toHaveBeenCalledExactlyOnceWith(book);
      expect(onOpenBook).not.toHaveBeenCalled();
    },
  );

  it("leaves the header without a control cluster when the library is empty", () => {
    renderLibrary(vi.fn(), []);

    const header = container!.querySelector("header")!;
    expect(header.querySelector('[aria-label="Search books"]')).toBeNull();
    expect(header.querySelector('nav[aria-label="Library navigation"]')).not.toBeNull();
  });
});
