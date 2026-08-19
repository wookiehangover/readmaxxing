import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runPromise: vi.fn() }));

vi.mock("~/lib/effect-runtime", () => ({
  AppRuntime: { runPromise: mocks.runPromise },
}));

import { clientLoader, createInitialFocusedState } from "~/routes/app-frame";

const books = [
  {
    id: "book-1",
    title: "Current title",
    author: "Author",
    coverImage: null,
    format: "epub" as const,
  },
];

describe("app-frame workspace restore", () => {
  it("keeps the client loader focused on its book-only boundary", async () => {
    mocks.runPromise.mockResolvedValueOnce(books);

    await expect(clientLoader()).resolves.toEqual({ books });
    expect(mocks.runPromise).toHaveBeenCalledOnce();
  });

  it("builds one focused-mode snapshot from selector values", () => {
    const state = createInitialFocusedState(books, {
      order: ["missing", "book-1"],
      activeBookId: "book-1",
      clusters: [
        {
          bookId: "missing",
          bookTitle: "Missing",
          hasChat: false,
          hasNotebook: false,
          activeTab: "book",
        },
        {
          bookId: "book-1",
          bookTitle: "Old title",
          hasChat: true,
          hasNotebook: false,
          activeTab: "chat",
        },
      ],
    });

    expect(state.order).toEqual(["book-1"]);
    expect(state.activeBookId).toBe("book-1");
    expect(state.clusters.get("book-1")).toMatchObject({
      bookTitle: "Current title",
      activeTab: "chat",
    });
  });
});
