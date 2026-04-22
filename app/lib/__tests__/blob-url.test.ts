import { describe, it, expect } from "vitest";
import { isPublicBlobUrl } from "~/lib/blob-url";

describe("isPublicBlobUrl", () => {
  it("returns true for a canonical public Vercel Blob URL", () => {
    expect(isPublicBlobUrl("https://abc123.public.blob.vercel-storage.com/covers/book-1.jpg")).toBe(
      true,
    );
  });

  it("returns false for a private Vercel Blob URL", () => {
    expect(isPublicBlobUrl("https://abc123.blob.vercel-storage.com/covers/book-1.jpg")).toBe(false);
  });

  it("returns false for a non-blob URL", () => {
    expect(isPublicBlobUrl("https://example.com/foo.jpg")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isPublicBlobUrl("")).toBe(false);
  });

  it("returns false for a malformed URL without throwing", () => {
    expect(() => isPublicBlobUrl("not a url")).not.toThrow();
    expect(isPublicBlobUrl("not a url")).toBe(false);
  });
});
