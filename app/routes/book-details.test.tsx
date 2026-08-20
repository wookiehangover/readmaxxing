import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  reloadBookFiles: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useRevalidator: () => ({ revalidate: mocks.revalidate, state: "idle" }),
  };
});
vi.mock("~/hooks/use-sync-listener", () => ({ useSyncListener: () => 0 }));
vi.mock("~/lib/sync/use-sync", () => ({
  useSyncActions: () => ({
    triggerSync: vi.fn(),
    isActive: false,
    reloadBookFiles: mocks.reloadBookFiles,
  }),
}));
vi.mock("~/lib/themis/provider", () => ({
  useAppStore: () => ({
    dispatch: mocks.dispatch,
    annotationsSelectors: {
      selectNotebookByBookId: { useValue: () => undefined },
      selectAnnotationsLoaded: { useValue: () => true },
    },
  }),
}));

import BookDetailsRoute from "./book-details";
import {
  replaceBookFileRequested,
  updateBookMetadataRequested,
} from "~/lib/themis/books/books-slice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mocks.dispatch.mockReset();
  mocks.reloadBookFiles.mockReset();
  mocks.revalidate.mockReset();
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("BookDetailsRoute", () => {
  it("dispatches metadata saves to the books saga", () => {
    const props = {
      loaderData: {
        book: {
          id: "book-1",
          title: "Book",
          author: "Author",
          coverImage: null,
          format: "epub" as const,
        },
      },
    } as unknown as Parameters<typeof BookDetailsRoute>[0];
    act(() => {
      root.render(<BookDetailsRoute {...props} />);
    });

    const saveButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Save",
    )!;
    act(() => saveButton.click());

    const action = mocks.dispatch.mock.calls
      .map(([dispatched]) => dispatched as ReturnType<typeof updateBookMetadataRequested>)
      .find((dispatched) => dispatched.type === updateBookMetadataRequested.type)!;
    expect(action.payload[0]).toMatchObject({ id: "book-1", title: "Book", author: "Author" });
    expect(action.payload[1]).toBe("update");
  });

  it("dispatches restores to the books saga as collection additions", () => {
    const props = {
      loaderData: {
        book: {
          id: "book-1",
          title: "Book",
          author: "Author",
          coverImage: null,
          format: "epub" as const,
          deletedAt: 123,
        },
      },
    } as unknown as Parameters<typeof BookDetailsRoute>[0];
    act(() => {
      root.render(<BookDetailsRoute {...props} />);
    });

    const restoreButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Restore",
    )!;
    act(() => restoreButton.click());

    const action = mocks.dispatch.mock.calls
      .map(([dispatched]) => dispatched as ReturnType<typeof updateBookMetadataRequested>)
      .find((dispatched) => dispatched.type === updateBookMetadataRequested.type)!;
    expect(action.payload[0]).toMatchObject({ id: "book-1", deletedAt: undefined });
    expect(action.payload[1]).toBe("restore");
  });

  it("dispatches replacement files to the books saga", () => {
    const props = {
      loaderData: {
        book: {
          id: "book-1",
          title: "Book",
          author: "Author",
          coverImage: null,
          format: "epub" as const,
        },
      },
    } as unknown as Parameters<typeof BookDetailsRoute>[0];
    act(() => {
      root.render(<BookDetailsRoute {...props} />);
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([new Uint8Array([1, 2, 3])], "replacement.epub");
    Object.defineProperty(input, "files", { configurable: true, value: [file] });

    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));

    const action = mocks.dispatch.mock.calls
      .map(([dispatched]) => dispatched as ReturnType<typeof replaceBookFileRequested>)
      .find((dispatched) => dispatched.type === replaceBookFileRequested.type)!;
    expect(action.type).toBe(replaceBookFileRequested.type);
    expect(action.payload[0]).toMatchObject({ bookId: "book-1", file, syncActive: false });
    expect(action.payload[0].reloadBookFiles).toBe(mocks.reloadBookFiles);
  });
});
