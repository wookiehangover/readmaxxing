import React, { act, useEffect, useImperativeHandle } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JSONContent } from "@tiptap/react";
import type { TiptapEditorHandle } from "~/components/tiptap-editor";

const editorState = vi.hoisted(() => ({
  content: undefined as JSONContent | undefined,
  ready: false,
  setContent: vi.fn(),
  appendHighlightReference: vi.fn(),
}));

vi.mock("~/hooks/use-sync-listener", () => ({ useSyncListener: () => 0 }));
vi.mock("~/lib/themis/provider", () => ({
  useAppStore: () => ({
    dispatch: vi.fn(),
    booksSelectors: {
      selectBookById: { useValue: () => ({ title: "Book title", author: "Book author" }) },
    },
    annotationsSelectors: {
      selectNotebookByBookId: {
        useValue: () => ({ content: editorState.content }),
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
  TiptapEditor: ({
    compact,
    placeholder,
    ref,
    onReady,
  }: {
    compact?: boolean;
    placeholder?: string;
    ref?: React.Ref<Partial<TiptapEditorHandle>>;
    onReady?: () => void;
  }) => {
    useImperativeHandle(ref, () => ({
      setContent: editorState.setContent,
      appendHighlightReference: editorState.appendHighlightReference,
    }));
    useEffect(() => {
      if (editorState.ready) onReady?.();
    }, [editorState.ready]);
    return (
      <div data-testid="notebook-editor" data-compact={compact} data-placeholder={placeholder} />
    );
  },
}));

import { WorkspaceNotebook } from "~/components/workspace-notebook";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

beforeEach(() => {
  editorState.content = undefined;
  editorState.ready = false;
  editorState.setContent.mockReset();
  editorState.appendHighlightReference.mockReset();
});

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
    expect(scrollContent?.classList.contains("pl-6")).toBe(true);
    expect(scrollContent?.classList.contains("md:pl-0")).toBe(true);
  });
});

it("applies the first persisted notebook after an empty editor becomes ready", () => {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  editorState.ready = true;
  const render = () => act(() => root?.render(<WorkspaceNotebook bookId="book-1" chromeless />));
  render();
  expect(editorState.setContent).toHaveBeenCalledExactlyOnceWith({
    type: "doc",
    content: [{ type: "paragraph" }],
  });
  editorState.content = {
    type: "doc",
    content: [
      {
        type: "highlightReference",
        attrs: {
          highlightId: "highlight-1",
          cfiRange: "epubcfi(/6/2)",
          text: "A passage",
        },
      },
    ],
  };
  render();
  expect(editorState.setContent).toHaveBeenNthCalledWith(2, editorState.content);
  render();
  expect(editorState.setContent).toHaveBeenCalledTimes(2);
});

it("registers highlight insertion only after the editor is ready", () => {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const register = vi.fn();
  const render = () =>
    act(() =>
      root?.render(<WorkspaceNotebook bookId="book-1" onRegisterAppendHighlight={register} />),
    );
  render();
  expect(register).not.toHaveBeenCalled();
  editorState.ready = true;
  render();
  expect(register).toHaveBeenCalledWith("book-1", expect.any(Function));
});
