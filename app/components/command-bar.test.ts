import { describe, expect, it, vi } from "vitest";
import { openCommandBarBook } from "~/components/command-bar";
import type { WorkspaceContextValue } from "~/lib/context/workspace-context";
import type { BookMeta } from "~/lib/stores/book-store";

const book: BookMeta = {
  id: "book-1",
  title: "Test Book",
  author: "Test Author",
  coverImage: null,
  format: "epub",
};

describe("openCommandBarBook", () => {
  it("opens the book and navigates to its reading route", () => {
    const openBook = vi.fn();
    const navigate = vi.fn();
    const workspace = {
      openBookRef: { current: openBook },
    } as Pick<WorkspaceContextValue, "openBookRef">;

    openCommandBarBook(book, workspace, navigate);

    expect(openBook).toHaveBeenCalledWith(book);
    expect(navigate).toHaveBeenCalledWith("/books/book-1");
  });
});
