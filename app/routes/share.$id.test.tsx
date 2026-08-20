import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), sharedReader: vi.fn() }));

vi.mock("~/lib/themis/provider", () => ({
  useAppStore: () => ({ dispatch: mocks.dispatch }),
}));

vi.mock("~/components/share/shared-book-reader", () => ({
  SharedBookReader: (props: { format: "epub" | "pdf" }) => {
    mocks.sharedReader(props);
    return <div data-testid={`shared-${props.format}-reader`} />;
  },
}));

import SharePage from "./share.$id";
import { importSharedBookRequested } from "~/lib/themis/books/books-slice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function availableShare({
  format = "pdf",
  fileUrl = "https://example.com/shared-book",
  currentCfi = null,
}: {
  format?: "epub" | "pdf";
  fileUrl?: string | null;
  currentCfi?: string | null;
} = {}): ComponentProps<typeof SharePage>["loaderData"] {
  return {
    status: "available",
    id: "share-1",
    shareChats: false,
    fileUrl,
    book: {
      title: "Shared Book",
      author: "Reader",
      coverUrl: "https://example.com/cover.jpg",
      format,
      currentCfi,
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
  mocks.sharedReader.mockReset();
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("SharePage", () => {
  it.each([
    ["EPUB", "epub", "epubcfi(/6/4!/4/2)", "shared-epub-reader"],
    ["PDF", "pdf", "page:12", "shared-pdf-reader"],
  ] as const)(
    "renders an available shared %s with the real reader",
    (_, format, currentCfi, testId) => {
      renderPage(availableShare({ format, currentCfi }));

      expect(container.querySelector(`[data-testid='${testId}']`)).not.toBeNull();
      expect(mocks.sharedReader).toHaveBeenCalledWith({
        shareId: "share-1",
        fileUrl: "https://example.com/shared-book",
        format,
        currentCfi,
      });
    },
  );

  it.each(["epub", "pdf"] as const)(
    "does not mount the %s reader when the signed file URL is missing",
    (format) => {
      renderPage(availableShare({ format, fileUrl: null }));

      expect(container.textContent).toContain("Shared book file unavailable");
      expect(mocks.sharedReader).not.toHaveBeenCalled();
    },
  );

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

    const banner = container.querySelector("[data-testid='share-banner']");
    expect(banner?.textContent).toContain("Shared by Sam");
    expect(banner?.textContent).toContain("Add to Library");
    expect(container.querySelector("[data-testid='share-reading-shell']")).not.toBeNull();
    expect(container.querySelector("[data-testid='share-book-surface']")).not.toBeNull();
    const discussRail = container.querySelector("[data-testid='share-discuss-rail']");
    const tabs = discussRail?.querySelectorAll("[role='tab']");
    expect(tabs).toHaveLength(1);
    expect(tabs?.[0]?.textContent).toBe("Discuss");
    expect(discussRail?.textContent).not.toMatch(/Notes|Outline|Review/);
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
