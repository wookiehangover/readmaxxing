import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOpenBooks } from "~/components/chat/use-open-books";
import type { WorkspaceContextValue } from "~/lib/context/workspace-context";
import type { BookMeta } from "~/lib/stores/book-store";

const mocks = vi.hoisted(() => ({ books: [] as BookMeta[] }));

vi.mock("~/lib/themis/provider", () => ({
  useAppStore: () => ({
    booksSelectors: { selectAllBooks: { useValue: () => mocks.books } },
  }),
}));

const firstBook: BookMeta = {
  id: "first",
  title: "First Book",
  author: "Author",
  coverImage: null,
  format: "epub",
};
const secondBook: BookMeta = { ...firstBook, id: "second", title: "Second Book" };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useOpenBooks", () => {
  it("derives open books from the Themis slice and workspace open IDs", () => {
    mocks.books = [firstBook, secondBook];
    const openBookIdsRef = { current: new Set(["first"]) };
    let notify = () => {};
    const workspace = {
      openBookIdsRef,
      subscribeClusterChanges: (listener: () => void) => {
        notify = listener;
        return () => {};
      },
    } as Pick<WorkspaceContextValue, "openBookIdsRef" | "subscribeClusterChanges">;

    function Harness() {
      const books = useOpenBooks(workspace as WorkspaceContextValue);
      return <div>{books.map((book) => book.title).join(",")}</div>;
    }

    act(() => root.render(<Harness />));
    expect(container.textContent).toBe("First Book");

    mocks.books = [{ ...firstBook, title: "Updated First" }, secondBook];
    openBookIdsRef.current = new Set(["first", "second"]);
    act(() => notify());

    expect(container.textContent).toBe("Updated First,Second Book");
  });
});
