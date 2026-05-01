import { beforeEach, describe, expect, it, vi } from "vitest";
import { uploadChapters, uploadChaptersOnce } from "~/lib/chat/upload-chapters";
import { isChaptersUploaded, markChaptersUploaded } from "~/lib/stores/chapter-upload-cache-store";
import type { BookChapter } from "~/lib/epub/epub-text-extract";

vi.mock("~/lib/stores/chapter-upload-cache-store", () => ({
  isChaptersUploaded: vi.fn(),
  markChaptersUploaded: vi.fn(),
}));

const chapter: BookChapter = {
  index: 0,
  title: "Chapter 1",
  text: "Text",
  spineStart: 0,
  spineEnd: 1,
};

describe("uploadChapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
  });

  it("skips normal uploads when the book was already uploaded", async () => {
    vi.mocked(isChaptersUploaded).mockResolvedValue(true);

    await uploadChaptersOnce("book-1", [chapter], "epub");

    expect(fetch).not.toHaveBeenCalled();
    expect(markChaptersUploaded).not.toHaveBeenCalled();
  });

  it("forces a re-upload even when the book was already uploaded", async () => {
    vi.mocked(isChaptersUploaded).mockResolvedValue(true);

    await uploadChapters("book-1", [chapter], "epub", { force: true });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/books/book-1/chapters",
      expect.objectContaining({ method: "POST" }),
    );
    expect(markChaptersUploaded).toHaveBeenCalledWith("book-1");
  });
});
