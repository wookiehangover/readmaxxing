import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));

vi.mock("~/lib/themis/provider", () => ({
  useAppStore: () => ({ dispatch: mocks.dispatch }),
}));

import { useBookDeletion } from "~/hooks/use-book-deletion";
import { useBookUpload } from "~/hooks/use-book-upload";
import { deleteBookRequested, uploadBooksRequested } from "~/lib/themis/books/books-slice";

afterEach(() => {
  mocks.dispatch.mockReset();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "confirm");
  document.body.innerHTML = "";
});

function mockConfirm(result: boolean) {
  Object.defineProperty(window, "confirm", {
    configurable: true,
    value: vi.fn(() => result),
  });
}

describe("book mutation hooks", () => {
  it("dispatches supported file-input uploads and resets the input", () => {
    const onBookAdded = vi.fn();
    const epub = new File(["epub"], "book.epub");
    const ignored = new File(["text"], "notes.txt");
    const input = document.createElement("input");
    Object.defineProperty(input, "files", { value: [epub, ignored] });
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    let handleFileInput: ReturnType<typeof useBookUpload>["handleFileInput"] = () => undefined;

    function Harness() {
      ({ handleFileInput } = useBookUpload({ onBookAdded }));
      return null;
    }

    act(() => root.render(<Harness />));
    handleFileInput({ target: input } as React.ChangeEvent<HTMLInputElement>);

    expect(mocks.dispatch).toHaveBeenCalledWith(uploadBooksRequested([epub], onBookAdded));
    expect(input.value).toBe("");
    act(() => root.unmount());
  });

  it("does not dispatch deletion when confirmation is cancelled", () => {
    const onBookDeleted = vi.fn();
    mockConfirm(false);
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    let handleDeleteBook: ReturnType<typeof useBookDeletion>["handleDeleteBook"] = () => undefined;

    function Harness() {
      ({ handleDeleteBook } = useBookDeletion({ onBookDeleted }));
      return null;
    }

    act(() => root.render(<Harness />));
    handleDeleteBook("book-1");

    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(onBookDeleted).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("dispatches confirmed deletion without invoking the callback in the hook", () => {
    const onBookDeleted = vi.fn();
    mockConfirm(true);
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    let handleDeleteBook: ReturnType<typeof useBookDeletion>["handleDeleteBook"] = () => undefined;

    function Harness() {
      ({ handleDeleteBook } = useBookDeletion({ onBookDeleted }));
      return null;
    }

    act(() => root.render(<Harness />));
    handleDeleteBook("book-1");

    expect(mocks.dispatch).toHaveBeenCalledWith(deleteBookRequested("book-1", onBookDeleted));
    expect(onBookDeleted).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
