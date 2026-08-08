import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StandardEbooksTable } from "~/components/workspace/standard-ebooks-table";
import type { SEBook } from "~/lib/standard-ebooks";

const books: SEBook[] = [
  {
    title: "Zeta",
    author: "Alice Author",
    urlPath: "/ebooks/zeta",
    coverUrl: "https://standardebooks.org/images/zeta.svg",
  },
  {
    title: "Alpha",
    author: "Zoe Writer",
    urlPath: "/ebooks/alpha",
    coverUrl: null,
  },
  {
    title: "Middle",
    author: "Mike Novelist",
    urlPath: "/ebooks/middle",
    coverUrl: null,
  },
];

let container: HTMLDivElement | undefined;
let root: Root | undefined;

function rowTitles() {
  return [...container!.querySelectorAll("tbody a")].map((link) => link.textContent);
}

function renderTable({
  isDownloading = () => false,
  isAdded = () => false,
  onDownload = vi.fn(),
}: Partial<
  Pick<React.ComponentProps<typeof StandardEbooksTable>, "isDownloading" | "isAdded" | "onDownload">
> = {}) {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => {
    root!.render(
      <StandardEbooksTable
        books={books}
        isDownloading={isDownloading}
        isAdded={isAdded}
        onDownload={onDownload}
      />,
    );
  });
  return onDownload;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("StandardEbooksTable", () => {
  it("links titles to Standard Ebooks and sorts by title and author", () => {
    renderTable();

    expect(rowTitles()).toEqual(["Alpha", "Middle", "Zeta"]);
    const alphaLink = container!.querySelector<HTMLAnchorElement>('a[href$="/ebooks/alpha"]')!;
    expect(alphaLink.href).toBe("https://standardebooks.org/ebooks/alpha");
    expect(alphaLink.target).toBe("_blank");
    expect(alphaLink.rel).toBe("noopener noreferrer");

    const authorHeader = [...container!.querySelectorAll("thead button")].find((button) =>
      button.textContent?.includes("Author"),
    )!;
    act(() => authorHeader.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(rowTitles()).toEqual(["Zeta", "Middle", "Alpha"]);
    act(() => authorHeader.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(rowTitles()).toEqual(["Alpha", "Middle", "Zeta"]);
  });

  it("renders download states and invokes the action for available books", () => {
    const onDownload = vi.fn();
    renderTable({
      isDownloading: (book) => book.urlPath === "/ebooks/zeta",
      isAdded: (book) => book.urlPath === "/ebooks/middle",
      onDownload,
    });

    const buttons = [...container!.querySelectorAll<HTMLButtonElement>("tbody button")];
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      "Add to Library",
      "Added",
      "Importing…",
    ]);
    expect(buttons.map((button) => button.disabled)).toEqual([false, true, true]);

    act(() => buttons[0].dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onDownload).toHaveBeenCalledOnce();
    expect(onDownload).toHaveBeenCalledWith(books[1]);
  });
});
