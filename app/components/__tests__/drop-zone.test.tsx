import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));

vi.mock("~/lib/themis/provider", () => ({
  useAppStore: () => ({ dispatch: mocks.dispatch }),
}));

import { DropZone } from "~/components/drop-zone";
import { uploadBooksRequested } from "~/lib/themis/books/books-slice";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mocks.dispatch.mockReset();
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("DropZone", () => {
  it("dispatches supported dropped files through the shared upload saga", () => {
    const onBookAdded = vi.fn();
    const epub = new File(["epub"], "book.epub");
    const ignored = new File(["text"], "notes.txt");
    act(() => root.render(<DropZone onBookAdded={onBookAdded}>Library</DropZone>));

    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: { types: ["Files"], files: [epub, ignored] },
    });
    act(() => container.firstElementChild!.dispatchEvent(drop));

    expect(mocks.dispatch).toHaveBeenCalledOnce();
    const action = mocks.dispatch.mock.calls[0]![0] as ReturnType<typeof uploadBooksRequested>;
    expect(action.payload[0]).toEqual([epub]);
    expect(action.payload[1]).toBe(onBookAdded);
    expect(container.textContent).toContain("Processing…");

    act(() => action.payload[2]?.());
    expect(container.textContent).not.toContain("Processing…");
  });

  it("settles processing when the upload saga reports an error", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const epub = new File(["epub"], "book.epub");
    act(() => root.render(<DropZone>Library</DropZone>));

    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { types: ["Files"], files: [epub] } });
    act(() => container.firstElementChild!.dispatchEvent(drop));
    const action = mocks.dispatch.mock.calls[0]![0] as ReturnType<typeof uploadBooksRequested>;
    act(() => action.payload[3]?.("parse failed"));

    expect(container.textContent).not.toContain("Processing…");
    expect(consoleError).toHaveBeenCalledWith("Failed to process file:", "parse failed");
    consoleError.mockRestore();
  });
});
