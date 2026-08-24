import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runPromise: vi.fn(),
  booksLoading: true,
}));

vi.mock("~/lib/stores/book-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/stores/book-store")>();
  return { ...actual, BookService: { ...actual.BookService, getBooks: mocks.runPromise } };
});
vi.mock("~/lib/themis/provider", () => ({
  useAppStore: () => ({
    booksSelectors: {
      selectBooksLoading: { useValue: () => mocks.booksLoading },
    },
  }),
}));

import { clientLoader, WorkspaceRestoreGate } from "~/routes/app-frame";

const books = [
  {
    id: "book-1",
    title: "Current title",
    author: "Author",
    coverImage: null,
    format: "epub" as const,
  },
];

beforeEach(() => {
  mocks.booksLoading = true;
  mocks.runPromise.mockReset();
});

describe("app-frame hydration", () => {
  it("keeps the client loader focused on its book-only boundary", async () => {
    mocks.runPromise.mockResolvedValueOnce(books);

    await expect(clientLoader()).resolves.toEqual({ books });
    expect(mocks.runPromise).toHaveBeenCalledOnce();
  });

  it("waits only for book hydration", () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    const renderGate = () =>
      createElement(WorkspaceRestoreGate, null, createElement("p", null, "Ready"));

    act(() => root.render(renderGate()));
    const loadingOverlay = container.querySelector('[data-testid="workspace-loading-overlay"]');
    expect(loadingOverlay?.getAttribute("role")).toBe("status");
    expect(loadingOverlay?.getAttribute("aria-busy")).toBe("true");
    expect(container.textContent).toBe("");

    mocks.booksLoading = false;
    act(() => root.render(renderGate()));
    expect(container.textContent).toBe("Ready");

    act(() => root.unmount());
    container.remove();
  });
});
