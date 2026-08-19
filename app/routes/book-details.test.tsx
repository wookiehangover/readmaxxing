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
vi.mock("~/hooks/use-effect-query", () => ({
  useEffectQuery: () => ({ data: null, isLoading: false }),
}));
vi.mock("~/lib/sync/use-sync", () => ({
  useSyncActions: () => ({
    triggerSync: vi.fn(),
    isActive: false,
    reloadBookFiles: mocks.reloadBookFiles,
  }),
}));
vi.mock("~/lib/themis/provider", () => ({
  useAppStore: () => ({ dispatch: mocks.dispatch }),
}));

import BookDetailsRoute from "./book-details";
import { replaceBookFileRequested } from "~/lib/themis/books/books-slice";

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

    expect(mocks.dispatch).toHaveBeenCalledOnce();
    const action = mocks.dispatch.mock.calls[0]![0] as ReturnType<typeof replaceBookFileRequested>;
    expect(action.type).toBe(replaceBookFileRequested.type);
    expect(action.payload[0]).toMatchObject({ bookId: "book-1", file, syncActive: false });
    expect(action.payload[0].reloadBookFiles).toBe(mocks.reloadBookFiles);
  });
});
