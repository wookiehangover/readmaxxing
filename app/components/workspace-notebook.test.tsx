import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/use-sync-listener", () => ({ useSyncListener: () => 0 }));
vi.mock("~/lib/themis/provider", () => ({
  useAppStore: () => ({
    dispatch: vi.fn(),
    booksSelectors: {
      selectBookById: { useValue: () => ({ title: "Book title", author: "Book author" }) },
    },
    annotationsSelectors: {
      selectNotebookByBookId: {
        useValue: () => ({ content: { type: "doc", content: [] } }),
      },
      selectAnnotationsLoaded: { useValue: () => true },
    },
  }),
}));
vi.mock("~/lib/context/workspace-context", () => ({
  useWorkspace: () => ({
    notebookEditorCallbackMap: { current: new Map() },
    notebookContentChangeMap: { current: new Map() },
  }),
}));
vi.mock("~/components/tiptap-editor", () => ({
  TiptapEditor: ({ compact, placeholder }: { compact?: boolean; placeholder?: string }) => (
    <div data-testid="notebook-editor" data-compact={compact} data-placeholder={placeholder} />
  ),
}));

import { WorkspaceNotebook } from "~/components/workspace-notebook";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("WorkspaceNotebook", () => {
  it("renders only the compact editor when chromeless", () => {
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    act(() =>
      root?.render(<WorkspaceNotebook bookId="book-1" bookTitle="Book title" chromeless />),
    );

    expect(container.textContent).not.toContain("Book title");
    expect(container.textContent).not.toContain("Book author");
    expect(container.textContent).not.toContain("Details");
    expect(container.textContent).not.toContain("Export as Markdown");
    expect(container.firstElementChild?.classList.contains("bg-card")).toBe(false);
    expect(
      container.querySelector("[data-testid='notebook-editor']")?.getAttribute("data-compact"),
    ).toBe("true");
    expect(
      container.querySelector("[data-testid='notebook-editor']")?.getAttribute("data-placeholder"),
    ).toBe("If you're not writing, you're not reading");
    const scrollContent = container.querySelector("[data-testid='notebook-editor']")?.parentElement;
    expect(scrollContent?.classList.contains("pr-6")).toBe(true);
    expect(scrollContent?.classList.contains("pl-6")).toBe(false);
  });
});
