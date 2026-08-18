import { describe, expect, it, vi } from "vitest";
import { activateReadingRoute, getBookReadingPath, getReadingBookId } from "./reading-route";
import type { BookMeta } from "~/lib/stores/book-store";

const book: BookMeta = {
  id: "book 1",
  title: "Test Book",
  author: "Test Author",
  coverImage: null,
  format: "epub",
};

describe("reading routes", () => {
  it("builds and matches the single-book reading URL", () => {
    const path = getBookReadingPath(book.id);
    expect(path).toBe("/books/book%201");
    expect(getReadingBookId(path)).toBe(book.id);
    expect(getReadingBookId(`${path}/details`)).toBeNull();
  });

  it("activates the book selected by the route", () => {
    const openBook = vi.fn();
    activateReadingRoute({
      bookId: book.id,
      books: [book],
      activeBookId: null,
      openBook,
      navigate: vi.fn(),
    });
    expect(openBook).toHaveBeenCalledWith(book);
  });

  it("replaces an unknown book route with the library", () => {
    const navigate = vi.fn();
    activateReadingRoute({
      bookId: "missing",
      books: [book],
      activeBookId: null,
      openBook: vi.fn(),
      navigate,
    });
    expect(navigate).toHaveBeenCalledWith("/library", { replace: true });
  });
});
