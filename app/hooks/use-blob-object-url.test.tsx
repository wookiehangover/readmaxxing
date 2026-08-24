import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBlobObjectUrl } from "~/hooks/use-blob-object-url";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useBlobObjectUrl", () => {
  let container: HTMLDivElement;
  let root: Root;
  let nextUrl: number;
  let revokedUrls: Set<string>;

  function Probe({ blob, cacheKey }: { blob: Blob | null; cacheKey: string | null }) {
    const url = useBlobObjectUrl(blob, cacheKey);
    return url ? <img src={url} alt="Book cover" /> : null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    nextUrl = 0;
    revokedUrls = new Set();
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:test-cover-${++nextUrl}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
      revokedUrls.add(url);
    });
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("keeps the rendered URL valid after development StrictMode replays effects", () => {
    act(() => {
      root.render(
        <StrictMode>
          <Probe blob={new Blob(["gatsby cover"])} cacheKey="demo-book" />
        </StrictMode>,
      );
    });

    const renderedUrl = container.querySelector("img")?.getAttribute("src");
    expect(renderedUrl).toMatch(/^blob:test-cover-/);
    expect(revokedUrls.has(renderedUrl!)).toBe(false);
  });

  it("reuses a live URL when IndexedDB returns a fresh Blob for the same book", () => {
    act(() => root.render(<Probe blob={new Blob(["cover"])} cacheKey="book-1" />));
    const originalUrl = container.querySelector("img")?.getAttribute("src");

    act(() => root.render(<Probe blob={new Blob(["cover"])} cacheKey="book-1" />));

    expect(container.querySelector("img")?.getAttribute("src")).toBe(originalUrl);
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(revokedUrls.has(originalUrl!)).toBe(false);
  });

  it("keeps the previous URL alive briefly when the book key changes", () => {
    act(() => root.render(<Probe blob={new Blob(["first cover"])} cacheKey="book-1" />));
    const previousUrl = container.querySelector("img")?.getAttribute("src");

    act(() => root.render(<Probe blob={new Blob(["second cover"])} cacheKey="book-2" />));
    const nextCoverUrl = container.querySelector("img")?.getAttribute("src");

    expect(nextCoverUrl).not.toBe(previousUrl);
    expect(revokedUrls.has(previousUrl!)).toBe(false);

    act(() => vi.advanceTimersByTime(2_000));

    expect(revokedUrls.has(previousUrl!)).toBe(true);
    expect(revokedUrls.has(nextCoverUrl!)).toBe(false);
  });

  it("revokes the active URL and pending replaced URLs on a real unmount", () => {
    act(() => root.render(<Probe blob={new Blob(["first cover"])} cacheKey="book-1" />));
    const previousUrl = container.querySelector("img")?.getAttribute("src");

    act(() => root.render(<Probe blob={new Blob(["second cover"])} cacheKey="book-2" />));
    const activeUrl = container.querySelector("img")?.getAttribute("src");

    act(() => root.unmount());

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(previousUrl);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(activeUrl);
    expect(vi.getTimerCount()).toBe(0);

    root = createRoot(container);
  });

  it("removes the rendered URL when the Blob or key becomes unavailable", () => {
    act(() => root.render(<Probe blob={new Blob(["cover"])} cacheKey="book-1" />));
    const previousUrl = container.querySelector("img")?.getAttribute("src");

    act(() => root.render(<Probe blob={null} cacheKey="book-1" />));
    expect(container.querySelector("img")).toBeNull();

    act(() => vi.advanceTimersByTime(2_000));
    expect(revokedUrls.has(previousUrl!)).toBe(true);

    act(() => root.render(<Probe blob={new Blob(["cover"])} cacheKey={null} />));
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
  });
});
