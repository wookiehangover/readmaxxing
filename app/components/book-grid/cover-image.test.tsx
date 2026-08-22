import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoverImage } from "~/components/book-grid/cover-image";
import { BookCover } from "~/components/book-list";
import { DEMO_BOOK_ID } from "~/lib/onboarding/demo-content";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const renderers = [
  {
    name: "grid cover",
    render: (bookId: string, coverImage: Blob, remoteCoverUrl?: string) => (
      <CoverImage
        bookId={bookId}
        coverImage={coverImage}
        remoteCoverUrl={remoteCoverUrl}
        alt="The Great Gatsby"
      />
    ),
  },
  {
    name: "list cover",
    render: (bookId: string, coverImage: Blob, remoteCoverUrl?: string) => (
      <BookCover bookId={bookId} coverImage={coverImage} remoteCoverUrl={remoteCoverUrl} />
    ),
  },
];

describe.each(renderers)("$name", ({ render }) => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:signed-out-demo-cover");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("renders a fresh signed-out demo cover without requesting a private endpoint", () => {
    act(() => root.render(render(DEMO_BOOK_ID, new Blob(["gatsby cover"]))));

    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:signed-out-demo-cover");
  });

  it("prefers the local demo cover when stale metadata contains a private cover URL", () => {
    act(() =>
      root.render(
        render(
          DEMO_BOOK_ID,
          new Blob(["gatsby cover"]),
          "/api/sync/files/download?bookId=stale-account-book&type=cover",
        ),
      ),
    );

    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:signed-out-demo-cover");
  });

  it("preserves the authenticated proxy for account-owned private covers", () => {
    act(() =>
      root.render(
        render(
          "account-book",
          new Blob(["account cover"]),
          "/api/sync/files/download?bookId=account-book&type=cover",
        ),
      ),
    );

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/api/sync/files/download?bookId=account-book&type=cover",
    );
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
