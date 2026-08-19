import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookMeta } from "~/lib/stores/book-store";

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), runPromise: vi.fn(), onBookAdded: vi.fn() }));

vi.mock("~/lib/effect-runtime", () => ({
  AppRuntime: { runPromise: mocks.runPromise },
}));
vi.mock("~/lib/themis/provider", () => ({
  useAppStore: () => ({ dispatch: mocks.dispatch }),
}));
vi.mock("~/lib/context/workspace-context", () => ({
  useWorkspace: () => ({ onBookAddedRef: { current: mocks.onBookAdded } }),
}));

import { SEBookCardsInChat } from "~/components/chat/se-book-cards";
import { uploadBooksRequested } from "~/lib/themis/books/books-slice";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mocks.dispatch.mockReset();
  mocks.runPromise.mockReset().mockResolvedValue(new ArrayBuffer(8));
  mocks.onBookAdded.mockReset();
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("SEBookCardsInChat", () => {
  it("downloads an EPUB then dispatches it through the shared upload saga", async () => {
    act(() =>
      root.render(
        <SEBookCardsInChat
          books={[
            { title: "Book One", author: "Author", urlPath: "/ebooks/book-one", coverUrl: null },
          ]}
        />,
      ),
    );

    const button = container.querySelector("button")!;
    await act(async () => {
      button.click();
      await Promise.resolve();
    });

    expect(mocks.runPromise).toHaveBeenCalledOnce();
    expect(mocks.dispatch).toHaveBeenCalledOnce();
    const action = mocks.dispatch.mock.calls[0]![0] as ReturnType<typeof uploadBooksRequested>;
    expect(action.payload[0][0]?.name).toBe("Book One.epub");

    const savedBook: BookMeta = {
      id: "saved",
      title: "Book One",
      author: "Author",
      coverImage: null,
      format: "epub",
    };
    act(() => action.payload[1]?.(savedBook));
    expect(mocks.onBookAdded).toHaveBeenCalledWith(savedBook);
    expect(button.textContent).toContain("Added");
  });
});
