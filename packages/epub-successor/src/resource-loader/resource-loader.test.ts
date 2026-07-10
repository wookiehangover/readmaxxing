import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  openZipResourceProvider,
  ResourceProviderClosedError,
  ResourceReadAbortedError,
  ZipEntryPathError,
} from "./resource-loader";

function archive(entries: Record<string, string>, level = 6): Uint8Array<ArrayBuffer> {
  return zipSync(
    Object.fromEntries(Object.entries(entries).map(([path, value]) => [path, strToU8(value)])),
    { level: level as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 },
  );
}

describe("ZipResourceProvider", () => {
  it("reads programmatically-built ZIP entries lazily from ArrayBuffer and Blob sources", async () => {
    const zip = archive({
      "META-INF/container.xml": "<container />",
      "OPS/chapter.xhtml": "<p>Hello</p>",
    });
    const fromBuffer = await openZipResourceProvider(zip.buffer);
    const fromBlob = await openZipResourceProvider(new Blob([zip]));

    expect(fromBuffer.entries()).toEqual(["META-INF/container.xml", "OPS/chapter.xhtml"]);
    expect(fromBuffer.has("OPS/chapter.xhtml#fragment")).toBe(true);
    await expect(fromBuffer.readText("OPS/chapter.xhtml")).resolves.toBe("<p>Hello</p>");
    await expect(fromBlob.readText("META-INF/container.xml")).resolves.toBe("<container />");

    fromBuffer.close();
    fromBlob.close();
  });

  it("fetches a URL source as a whole-file MVP adapter", async () => {
    const zip = archive({ mimetype: "application/epub+zip" }, 0);
    const provider = await openZipResourceProvider(new URL("https://example.invalid/book.epub"), {
      fetch: async () => new Response(zip.buffer),
    });

    await expect(provider.readText("mimetype")).resolves.toBe("application/epub+zip");
    provider.close();
  });

  it.each(["../evil", "/abs", "OPS\\chapter.xhtml"])(
    "rejects unsafe archive entry path %s",
    async (path) => {
      await expect(
        openZipResourceProvider(archive({ [path]: "bad" }).buffer),
      ).rejects.toBeInstanceOf(ZipEntryPathError);
    },
  );

  it("rejects unsafe lookup paths at the provider boundary", async () => {
    const provider = await openZipResourceProvider(archive({ "OPS/chapter.xhtml": "ok" }).buffer);

    expect(() => provider.has("OPS\\chapter.xhtml")).toThrow(ZipEntryPathError);
    provider.close();
  });

  it("enforces entry-count limits before exposing entries", async () => {
    const zip = archive({ "one.txt": "one", "two.txt": "two" });

    await expect(
      openZipResourceProvider(zip.buffer, { limits: { maxEntryCount: 1 } }),
    ).rejects.toMatchObject({
      limit: "maxEntryCount",
      actual: 2,
      maximum: 1,
    });
  });

  it("rejects a small crafted high-ratio archive", async () => {
    const zip = archive({ "bomb.txt": "0".repeat(100_000) });

    await expect(
      openZipResourceProvider(zip.buffer, { limits: { maxCompressionRatio: 2 } }),
    ).rejects.toMatchObject({ limit: "maxCompressionRatio" });
  });

  it("aborts an in-progress deflated read", async () => {
    const zip = archive({ "large.txt": "readmaxxing".repeat(200_000) });
    const provider = await openZipResourceProvider(zip.buffer, {
      limits: { maxCompressionRatio: 10_000 },
    });
    const controller = new AbortController();

    const read = provider.read("large.txt", controller.signal);
    controller.abort();

    await expect(read).rejects.toBeInstanceOf(ResourceReadAbortedError);
    provider.close();
  });

  it("deterministically cancels pending reads and releases entries on close", async () => {
    const provider = await openZipResourceProvider(
      archive({ "large.txt": "close-me".repeat(200_000) }).buffer,
      { limits: { maxCompressionRatio: 10_000 } },
    );

    const read = provider.read("large.txt");
    provider.close();

    await expect(read).rejects.toBeInstanceOf(ResourceProviderClosedError);
    expect(() => provider.entries()).toThrow(ResourceProviderClosedError);
  });
});
