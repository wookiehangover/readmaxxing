import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  assembleSectionDocument,
  CONTENT_SECURITY_POLICY,
} from "../src/content-pipeline/content-pipeline";
import { openPublication } from "../src/epub-parser/publication";
import { normalizePublicationPath } from "../src/publication-model/paths";
import {
  openZipResourceProvider,
  ZipEntryPathError,
  ZipLimitError,
} from "../src/resource-loader/resource-loader";
import { buildFixtureArchives, MALICIOUS_FIXTURE_NAMES, VALID_FIXTURE_NAMES } from "./build";

async function bytes(name: string): Promise<ArrayBuffer> {
  return Uint8Array.from(await readFile(new URL(name, import.meta.url))).buffer;
}

async function open(name: string) {
  return openZipResourceProvider(await bytes(name));
}

describe("committed EPUB fixtures", () => {
  it("are byte-identical to deterministic generator output", async () => {
    const generated = buildFixtureArchives();
    expect(Object.keys(generated)).toEqual([...VALID_FIXTURE_NAMES, ...MALICIOUS_FIXTURE_NAMES]);
    for (const [name, expected] of Object.entries(generated)) {
      expect(new Uint8Array(await bytes(name))).toEqual(expected);
    }
  });

  it.each(VALID_FIXTURE_NAMES)("opens valid fixture %s", async (name) => {
    const provider = await open(name);
    try {
      const result = await openPublication(provider);
      expect(result.publication).not.toBeNull();
      expect(result.diagnostics.filter(({ severity }) => severity === "error")).toEqual([]);
    } finally {
      provider.close();
    }
  });

  it("preserves the valid fixtures' distinguishing features", async () => {
    const epub2 = await open("minimal-epub2.epub");
    const rtl = await open("rtl.epub");
    const nested = await open("nested-paths.epub");
    const duplicate = await open("duplicate-spine.epub");
    const font = await open("embedded-font.epub");
    const images = await open("images.epub");
    try {
      expect((await openPublication(epub2)).navigationSource).toBe("ncx");
      expect((await openPublication(rtl)).publication?.metadata.pageProgressionDirection).toBe(
        "rtl",
      );
      expect(await rtl.readText("EPUB/text/chapter.xhtml")).toContain("עברית");
      expect((await openPublication(nested)).packagePath).toBe(
        "publication/package/metadata/content.opf",
      );
      expect((await openPublication(duplicate)).diagnostics).toContainEqual(
        expect.objectContaining({ code: "OPF_DUPLICATE_SPINE_REF" }),
      );
      expect(font.has("EPUB/fonts/fixture.woff")).toBe(true);
      expect(images.has("EPUB/images/pixel.png")).toBe(true);
    } finally {
      for (const provider of [epub2, rtl, nested, duplicate, font, images]) provider.close();
    }
  });

  it("rejects malicious ZIP structures with typed errors", async () => {
    await expect(open("path-traversal.epub")).rejects.toBeInstanceOf(ZipEntryPathError);
    await expect(open("high-compression-ratio.epub")).rejects.toMatchObject({
      constructor: ZipLimitError,
      limit: "maxCompressionRatio",
    });
    await expect(open("extreme-entry-count.epub")).rejects.toMatchObject({
      constructor: ZipLimitError,
      limit: "maxEntryCount",
    });
  });

  it.each([
    ["script-content.epub", ["script", "onclick", "javascript:"]],
    ["external-references.epub", ["https://example.invalid"]],
    ["meta-refresh.epub", ['http-equiv="refresh"']],
  ] as const)("opens and sanitizes malicious content fixture %s", async (name, vectors) => {
    const provider = await open(name);
    try {
      const result = await openPublication(provider);
      expect(result.publication).not.toBeNull();
      const source = await provider.readText("EPUB/text/chapter.xhtml");
      for (const vector of vectors) expect(source.toLowerCase()).toContain(vector.toLowerCase());
      if (name === "external-references.epub") {
        expect(CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
        expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'none'");
        return;
      }
      const document = new DOMParser().parseFromString(source, "application/xhtml+xml");
      const assembled = assembleSectionDocument(document, {
        context: {
          sectionHref: normalizePublicationPath("EPUB/text/chapter.xhtml"),
          spineIndex: 0,
        },
      });
      const sanitized = new DOMParser().parseFromString(assembled.html, "application/xhtml+xml");
      expect(sanitized.getElementsByTagName("script")).toHaveLength(0);
      expect(sanitized.querySelector("[onclick]")).toBeNull();
      expect(sanitized.querySelector('a[href^="javascript:"]')).toBeNull();
      expect(sanitized.querySelector('meta[http-equiv="refresh"]')).toBeNull();
      expect(assembled.contentSecurityPolicy).toContain("connect-src 'none'");
    } finally {
      provider.close();
    }
  });
});
