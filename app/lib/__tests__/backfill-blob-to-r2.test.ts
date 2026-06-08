import { describe, expect, it } from "vitest";

import { classifyBookStorage, deriveR2ObjectKey } from "../../../scripts/backfill-blob-to-r2";

describe("backfill-blob-to-r2 helpers", () => {
  it("classifies only legacy Vercel Blob references for migration", () => {
    const items = classifyBookStorage({
      id: "book-1",
      userId: "user-1",
      fileBlobUrl: "https://store.blob.vercel-storage.com/books/book.epub",
      coverBlobUrl: "r2://covers/covers/user-1/book-1/cover.jpg",
    });

    expect(items).toEqual([
      {
        bookId: "book-1",
        userId: "user-1",
        type: "file",
        column: "fileBlobUrl",
        oldUrl: "https://store.blob.vercel-storage.com/books/book.epub",
      },
    ]);
  });

  it("derives the same R2 key scheme as the upload endpoint", () => {
    expect(
      deriveR2ObjectKey({
        type: "file",
        userId: "user@example.com",
        bookId: "book/with/slashes",
        contentType: "application/pdf; charset=utf-8",
      }),
    ).toBe("books/user%40example.com/book%2Fwith%2Fslashes/book.pdf");

    expect(
      deriveR2ObjectKey({
        type: "cover",
        userId: "user-1",
        bookId: "book-1",
        contentType: "image/webp",
      }),
    ).toBe("covers/user-1/book-1/cover.webp");
  });
});
