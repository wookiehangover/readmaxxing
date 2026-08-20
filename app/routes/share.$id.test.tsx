import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
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

function availableShare(): ComponentProps<typeof SharePage>["loaderData"] {
  return {
    status: "available",
    id: "share-1",
    shareChats: false,
    book: {
      title: "Shared Book",
      author: "Reader",
      coverUrl: "https://example.com/cover.jpg",
      format: "pdf",
      currentCfi: null,
    },
    sharer: { id: "user-1", displayName: "Sam" },
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderPage(
  loaderData: ComponentProps<typeof SharePage>["loaderData"] = availableShare(),
  includeLocation = false,
) {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/share/share-1"]}>
        <SharePage loaderData={loaderData} />
        {includeLocation && <LocationProbe />}
      </MemoryRouter>,
    );
  });
}

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
    renderPage();

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

  it("renders the full-viewport reading chrome instead of the landing-page layout", () => {
    renderPage();

    expect(container.querySelector("[data-testid='share-banner']")?.textContent).toContain(
      "Shared by Sam",
    );
    expect(container.querySelector("[data-testid='share-reading-shell']")).not.toBeNull();
    expect(container.querySelector("[data-testid='share-book-surface']")).not.toBeNull();
    expect(container.querySelector("[data-testid='share-discuss-rail']")?.textContent).toContain(
      "Discuss",
    );
    expect(container.textContent).not.toContain("Shared on Readmaxxing");
    expect(container.querySelector("img[alt='Cover for Shared Book']")).toBeNull();
  });

  it("does not mount reading chrome for unavailable shares", () => {
    renderPage({
      status: "expired",
      id: "share-1",
      shareChats: false,
      message: "This share link has expired.",
      book: availableShare().book,
    });

    expect(container.textContent).toContain("This share link has expired.");
    expect(container.querySelector("[data-testid='share-reading-shell']")).toBeNull();
    expect(container.querySelector("[data-testid='share-book-surface']")).toBeNull();
  });

  it("opens the imported book in the personal reader", () => {
    renderPage(availableShare(), true);
    const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Add to Library"),
    );
    act(() => button?.click());

    const action = mocks.dispatch.mock.calls[0]![0] as ReturnType<typeof importSharedBookRequested>;
    const onCompleted = action.payload[1] as (book: { id: string }) => void;
    act(() => onCompleted({ id: "book-42" }));

    expect(container.querySelector("[data-testid='location']")?.textContent).toBe("/books/book-42");
  });

  it("shows an import error in the persistent banner", () => {
    renderPage();
    const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Add to Library"),
    );
    act(() => button?.click());

    const action = mocks.dispatch.mock.calls[0]![0] as ReturnType<typeof importSharedBookRequested>;
    act(() => action.payload[2]("Import failed"));

    expect(
      container.querySelector("[data-testid='share-banner']")?.getAttribute("data-status"),
    ).toBe("error");
    expect(container.textContent).toContain("Import failed");
  });
});
