import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BookChapter } from "~/lib/epub/epub-text-extract";
import { DEMO_BOOK_ID } from "~/lib/onboarding/demo-content";

const { getMock, uploadChaptersMock, isChaptersUploadedMock, extractBookChaptersMock } = vi.hoisted(
  () => ({
    getMock: vi.fn(),
    uploadChaptersMock: vi.fn(),
    isChaptersUploadedMock: vi.fn(),
    extractBookChaptersMock: vi.fn(),
  }),
);

vi.mock("idb-keyval", () => ({ get: getMock }));
vi.mock("~/lib/chat/upload-chapters", () => ({ uploadChapters: uploadChaptersMock }));
vi.mock("~/lib/stores/chapter-upload-cache-store", () => ({
  isChaptersUploaded: isChaptersUploadedMock,
}));
vi.mock("~/lib/epub/epub-text-extract", () => ({
  extractBookChapters: extractBookChaptersMock,
}));
vi.mock("../stores", () => ({
  getBookStore: () => "book-store",
  getBookDataStore: () => "book-data-store",
}));

import { ensureBookChaptersUploaded } from "../book-chapter-uploads";

const chapters: BookChapter[] = [
  { index: 0, title: "Chapter 1", text: "Text", spineStart: 0, spineEnd: 1 },
];

describe("ensureBookChaptersUploaded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isChaptersUploadedMock.mockResolvedValue(false);
    uploadChaptersMock.mockResolvedValue(undefined);
  });

  it("never prepares or uploads chapters for the reserved demo book", async () => {
    await ensureBookChaptersUploaded(DEMO_BOOK_ID, { chapters, format: "epub" });

    expect(isChaptersUploadedMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
    expect(uploadChaptersMock).not.toHaveBeenCalled();
  });

  it("does no extraction work when the current cache version is uploaded", async () => {
    isChaptersUploadedMock.mockResolvedValue(true);

    await ensureBookChaptersUploaded("book-1");

    expect(getMock).not.toHaveBeenCalled();
    expect(uploadChaptersMock).not.toHaveBeenCalled();
  });

  it("extracts and uploads a stale open book from local storage", async () => {
    const data = new ArrayBuffer(8);
    getMock.mockResolvedValueOnce({ format: "epub" }).mockResolvedValueOnce(data);
    extractBookChaptersMock.mockResolvedValue(chapters);

    await ensureBookChaptersUploaded("book-1");

    expect(extractBookChaptersMock).toHaveBeenCalledWith(data);
    expect(uploadChaptersMock).toHaveBeenCalledWith("book-1", chapters, "epub", {
      force: false,
    });
  });

  it("reuses chat's extracted chapters and shares an in-flight upload", async () => {
    let finishUpload!: () => void;
    uploadChaptersMock.mockImplementation(
      () => new Promise<void>((resolve) => (finishUpload = resolve)),
    );

    const first = ensureBookChaptersUploaded("book-1", { chapters, format: "epub" });
    const second = ensureBookChaptersUploaded("book-1", { chapters, format: "epub" });

    expect(first).toBe(second);
    expect(getMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(uploadChaptersMock).toHaveBeenCalledTimes(1));
    finishUpload();
    await first;
  });
});
