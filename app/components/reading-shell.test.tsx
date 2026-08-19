import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const epubReaderProps = vi.hoisted(() => ({
  current: null as null | {
    bookId: string;
    panelTypography?: { readerLayout?: string };
  },
}));

vi.mock("~/components/workspace-book-reader", () => ({
  WorkspaceBookReader: (props: { bookId: string; panelTypography?: { readerLayout?: string } }) => {
    epubReaderProps.current = props;
    return <div data-testid="epub-reader">{props.bookId}</div>;
  },
}));
vi.mock("~/components/workspace-pdf-reader", () => ({
  WorkspacePdfReader: ({ bookId }: { bookId: string }) => (
    <div data-testid="pdf-reader">{bookId}</div>
  ),
}));
vi.mock("~/components/reading-shell/reading-rail", () => ({
  ReadingRail: () => <div data-testid="reading-rail">Rail</div>,
}));
vi.mock("~/lib/themis/provider", () => ({
  useAppStore: () => ({
    booksSelectors: {
      selectBookById: { useValue: (bookId: string) => books.find((book) => book.id === bookId) },
    },
  }),
}));

import { ReadingShell } from "~/components/reading-shell";
import { useWorkspace, WorkspaceProvider } from "~/lib/context/workspace-context";
import type { BookMeta } from "~/lib/stores/book-store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let activeBookId: string | null = "epub-book";
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
  epubReaderProps.current = null;
  window.sessionStorage.clear();
  document.title = "Readmaxxing";
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function renderShell() {
  function Harness() {
    const workspace = useWorkspace();
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

function dispatchPointer(target: Element, type: string, clientX: number, pointerId = 1) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, {
    clientX: { value: clientX },
    pointerId: { value: pointerId },
  });
  act(() => target.dispatchEvent(event));
}

function setShellWidth(width: number) {
  const shell = document.body.querySelector<HTMLElement>("[data-testid='reading-shell']");
  shell!.getBoundingClientRect = () =>
    ({ width, height: 800, x: 0, y: 0, top: 0, right: width, bottom: 800, left: 0 }) as DOMRect;
}

describe("ReadingShell", () => {
  it("restores the previous title on unmount while it still owns the title", () => {
    renderShell();

    expect(document.title).toBe("EPUB Book");

    act(() => root?.unmount());
    root = null;
    expect(document.title).toBe("Readmaxxing");
  });

  it("does not overwrite a destination title set before unmount", () => {
    renderShell();
    document.title = "Settings — Readmaxxing";

    act(() => root?.unmount());
    root = null;

    expect(document.title).toBe("Settings — Readmaxxing");
  });

  it("uses the default title while no book is open", () => {
    document.title = "Previous Book";
    activeBookId = null;

    renderShell();

    expect(document.title).toBe("Readmaxxing");
  });

  it("mounts an EPUB reader with one book surface and the reading rail", () => {
    renderShell();

    expect(document.body.querySelector("[data-testid='epub-reader']")?.textContent).toBe(
      "epub-book",
    );
    expect(document.body.querySelector("[aria-label='Book surface']")).not.toBeNull();
    expect(document.body.querySelector("[aria-label='Reading rail']")).not.toBeNull();
    expect(document.body.querySelector("[data-testid='reading-rail']")).not.toBeNull();
  });

  it("defaults the shell EPUB reader to a spread without dockview chrome", () => {
    renderShell();

    expect(epubReaderProps.current).toEqual({
      bookId: "epub-book",
      panelTypography: { readerLayout: "spread" },
    });
  });

  it("mounts the existing PDF reader in the same shell", () => {
    activeBookId = "pdf-book";
    renderShell();

    expect(document.body.querySelector("[data-testid='pdf-reader']")?.textContent).toBe("pdf-book");
    expect(document.body.querySelector("[data-testid='epub-reader']")).toBeNull();
  });

  it("keeps the divider hidden until hover or keyboard focus", () => {
    renderShell();
    const divider = document.body.querySelector<HTMLElement>("[role='separator']")!;
    const line = document.body.querySelector<HTMLElement>("[data-testid='reading-divider-line']")!;

    expect(line.dataset.visible).toBe("false");
    dispatchPointer(divider, "pointerover", 0);
    expect(line.dataset.visible).toBe("true");
    dispatchPointer(divider, "pointerout", 0);
    expect(line.dataset.visible).toBe("false");

    act(() => divider.focus());
    expect(line.dataset.visible).toBe("true");
  });

  it("drags the rail width and persists it for the session", () => {
    renderShell();
    setShellWidth(1200);
    const divider = document.body.querySelector<HTMLElement>("[role='separator']")!;
    const rail = document.body.querySelector<HTMLElement>("[aria-label='Reading rail']")!;

    dispatchPointer(divider, "pointerdown", 800);
    dispatchPointer(divider, "pointermove", 700);
    dispatchPointer(divider, "pointerup", 700);

    expect(rail.style.width).toBe("484px");
    expect(window.sessionStorage.getItem("reading-rail-width")).toBe("484");
  });

  it("resets the rail width on double-click and persists the default", () => {
    renderShell();
    setShellWidth(1200);
    const divider = document.body.querySelector<HTMLElement>("[role='separator']")!;
    const rail = document.body.querySelector<HTMLElement>("[aria-label='Reading rail']")!;

    dispatchPointer(divider, "pointerdown", 800);
    dispatchPointer(divider, "pointermove", 700);
    act(() => divider.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));

    expect(rail.style.width).toBe("384px");
    expect(window.sessionStorage.getItem("reading-rail-width")).toBe("384");
  });

  it("clamps the double-click reset when the viewport cannot fit the default", () => {
    renderShell();
    setShellWidth(960);
    const divider = document.body.querySelector<HTMLElement>("[role='separator']")!;
    const rail = document.body.querySelector<HTMLElement>("[aria-label='Reading rail']")!;

    act(() => divider.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));

    expect(rail.style.width).toBe("320px");
    expect(window.sessionStorage.getItem("reading-rail-width")).toBe("320");
  });

  it("restores the rail width saved in the current session", () => {
    window.sessionStorage.setItem("reading-rail-width", "352");
    renderShell();

    const rail = document.body.querySelector<HTMLElement>("[aria-label='Reading rail']")!;
    expect(rail.style.width).toBe("352px");
  });

  it("keeps usable minimum widths for the rail and book spread", () => {
    renderShell();
    setShellWidth(1200);
    const divider = document.body.querySelector<HTMLElement>("[role='separator']")!;
    const rail = document.body.querySelector<HTMLElement>("[aria-label='Reading rail']")!;

    dispatchPointer(divider, "pointerdown", 800);
    dispatchPointer(divider, "pointermove", 2000);
    dispatchPointer(divider, "pointerup", 2000);
    expect(rail.style.width).toBe("320px");

    dispatchPointer(divider, "pointerdown", 800, 2);
    dispatchPointer(divider, "pointermove", 0, 2);
    dispatchPointer(divider, "pointerup", 0, 2);
    expect(rail.style.width).toBe("560px");
  });
});
