import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));

vi.mock("~/lib/themis/provider", () => ({
  useAppStore: () => ({ dispatch: mocks.dispatch }),
}));

import SharePage from "./share.$id";
import { importSharedBookRequested } from "~/lib/themis/books/books-slice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

describe("SharePage", () => {
  it("dispatches a shared-book import request instead of saving directly", () => {
    act(() => {
      root.render(
        <MemoryRouter>
          <SharePage
            loaderData={{
              status: "available",
              id: "share-1",
              shareChats: false,
              book: {
                title: "Shared Book",
                author: "Reader",
                coverUrl: null,
                format: "pdf",
                currentCfi: null,
              },
            }}
          />
        </MemoryRouter>,
      );
    });

    const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Add to Library"),
    );
    act(() => button?.click());

    expect(mocks.dispatch).toHaveBeenCalledOnce();
    const action = mocks.dispatch.mock.calls[0]![0] as ReturnType<typeof importSharedBookRequested>;
    expect(action.type).toBe(importSharedBookRequested.type);
    expect(action.payload[0]).toEqual({
      shareId: "share-1",
      title: "Shared Book",
      author: "Reader",
      format: "pdf",
    });
  });
});
