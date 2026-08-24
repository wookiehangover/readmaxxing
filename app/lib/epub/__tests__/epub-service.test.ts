import { readFile } from "node:fs/promises";

import * as successor from "@readmaxxing/epub-successor";
import { describe, expect, it, vi } from "vitest";

import { parseEpub } from "~/lib/epub/epub-service";

async function fixtureData(): Promise<ArrayBuffer> {
  const bytes = await readFile("e2e/fixtures/test-book.epub");
  return Uint8Array.from(bytes).buffer;
}

describe("EpubService", () => {
  it("extracts import metadata from the e2e EPUB fixture", async () => {
    const metadata = await parseEpub(await fixtureData());

    expect(metadata).toEqual({
      title: "Test Book for E2E",
      author: "Test Author",
      coverImage: null,
    });
  });

  it("joins authors, extracts a cover Blob, and closes the provider", async () => {
    const data = await fixtureData();
    const fixtureProvider = await successor.openZipResourceProvider(data);
    const fixtureResult = await successor.openPublication(fixtureProvider);
    fixtureProvider.close();
    const fixturePublication = fixtureResult.publication;
    const fixtureResource = fixturePublication?.resources[0];
    expect(fixturePublication).not.toBeNull();
    expect(fixtureResource).toBeDefined();
    if (!fixturePublication || !fixtureResource) return;

    const openSpy = vi.spyOn(successor, "openPublication").mockResolvedValue({
      ...fixtureResult,
      publication: {
        ...fixturePublication,
        metadata: {
          ...fixturePublication.metadata,
          authors: [{ name: "First Author" }, { name: "Second Author" }],
        },
        resources: [{ ...fixtureResource, rel: ["cover"], properties: ["cover-image"] }],
      },
    });
    const closeSpy = vi.spyOn(successor.ZipResourceProvider.prototype, "close");

    try {
      const metadata = await parseEpub(data);

      expect(metadata.author).toBe("First Author, Second Author");
      expect(metadata.coverImage).toBeInstanceOf(Blob);
      expect(metadata.coverImage?.size).toBeGreaterThan(0);
      expect(closeSpy).toHaveBeenCalledOnce();
    } finally {
      openSpy.mockRestore();
      closeSpy.mockRestore();
    }
  });

  it("reports invalid EPUB data as an EpubParseError", async () => {
    const error = await parseEpub(new ArrayBuffer(0)).catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      _tag: "EpubParseError",
      operation: "parseEpub:acquire",
    });
  });
});
