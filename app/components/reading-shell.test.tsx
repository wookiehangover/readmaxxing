import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("~/components/workspace-book-reader", () => ({
  WorkspaceBookReader: ({ bookId }: { bookId: string }) => (
    <div data-testid="epub-reader">{bookId}</div>
  ),
}));
vi.mock("~/components/workspace-pdf-reader", () => ({
  WorkspacePdfReader: ({ bookId }: { bookId: string }) => (
    <div data-testid="pdf-reader">{bookId}</div>
  ),
}));

import { ReadingShell } from "~/components/reading-shell";
import { useWorkspace, WorkspaceProvider } from "~/lib/context/workspace-context";
import type { BookMeta } from "~/lib/stores/book-store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let activeBookId = "epub-book";
const books: BookMeta[] = [
  {
    id: "epub-book",
    title: "EPUB Book",
    author: "Author",
    coverImage: null,
    format: "epub",
  },
  {
    id: "pdf-book",
    title: "PDF Book",
    author: "Author",
    coverImage: null,
    format: "pdf",
  },
];

beforeEach(() => {
  activeBookId = "epub-book";
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function renderShell() {
  function Harness() {
    const workspace = useWorkspace();
    workspace.booksRef.current = books;
    workspace.activeClusterBookIdRef.current = activeBookId;
    return <ReadingShell />;
  }

  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() =>
    root?.render(
      <WorkspaceProvider>
        <Harness />
      </WorkspaceProvider>,
    ),
  );
}

describe("ReadingShell", () => {
  it("mounts an EPUB reader with one book surface and a placeholder rail", () => {
    renderShell();

    expect(document.body.querySelector("[data-testid='epub-reader']")?.textContent).toBe(
      "epub-book",
    );
    expect(document.body.querySelector("[aria-label='Book surface']")).not.toBeNull();
    expect(document.body.querySelector("[aria-label='Reading rail']")).not.toBeNull();
  });

  it("mounts the existing PDF reader in the same shell", () => {
    activeBookId = "pdf-book";
    renderShell();

    expect(document.body.querySelector("[data-testid='pdf-reader']")?.textContent).toBe("pdf-book");
    expect(document.body.querySelector("[data-testid='epub-reader']")).toBeNull();
  });
});
