import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAPTER_UPLOAD_NOT_FOUND_RETRY_DELAYS_MS,
  uploadChapters,
  uploadChaptersOnce,
} from "~/lib/chat/upload-chapters";
import { isChaptersUploaded, markChaptersUploaded } from "~/lib/stores/chapter-upload-cache-store";
import type { BookChapter } from "~/lib/epub/epub-text-extract";
import { DEMO_BOOK_ID } from "~/lib/onboarding/demo-content";

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
    vi.mocked(isChaptersUploaded).mockResolvedValue(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("never sends or marks chapters for the reserved demo book", async () => {
    await uploadChapters(DEMO_BOOK_ID, [chapter], "epub", { force: true });

    expect(fetch).not.toHaveBeenCalled();
    expect(isChaptersUploaded).not.toHaveBeenCalled();
    expect(markChaptersUploaded).not.toHaveBeenCalled();
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

  it("triggers a sync push and retries 404 responses until the book exists", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("{}", { status: 404 }))
      .mockResolvedValueOnce(new Response("{}", { status: 404 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const pushNeeded = vi.fn();
    window.addEventListener("sync:push-needed", pushNeeded);

    const upload = uploadChaptersOnce("book-1", [chapter], "epub");
    await vi.runAllTimersAsync();
    await upload;

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(pushNeeded).toHaveBeenCalledTimes(2);
    expect(markChaptersUploaded).toHaveBeenCalledWith("book-1");
    window.removeEventListener("sync:push-needed", pushNeeded);
  });

  it("stops retrying 404 responses after the finite retry budget", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(async () => new Response("not found", { status: 404 }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const upload = uploadChaptersOnce("book-1", [chapter], "epub");
    await vi.runAllTimersAsync();
    await upload;

    expect(fetch).toHaveBeenCalledTimes(CHAPTER_UPLOAD_NOT_FOUND_RETRY_DELAYS_MS.length + 1);
    expect(markChaptersUploaded).not.toHaveBeenCalled();
  });

  it.each([401, 503])("does not mark chapters uploaded after a %s response", async (status) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status }));

    await uploadChaptersOnce("book-1", [chapter], "epub");

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(markChaptersUploaded).not.toHaveBeenCalled();
  });
});
