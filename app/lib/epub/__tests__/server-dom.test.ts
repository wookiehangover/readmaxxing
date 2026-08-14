// @vitest-environment node

import { readFile } from "node:fs/promises";
import {
  generateCfi,
  openPublication,
  openZipResourceProvider,
  parseCfi,
  resolveCfi,
  type Publication,
  type SectionMetadata,
} from "@readmaxxing/epub-successor";
import { describe, expect, it } from "vitest";

import { parseEpubServerDocument, withEpubServerDom } from "~/lib/epub/server-dom";

const FIXTURE_URL = new URL("../../../../e2e/fixtures/test-book.epub", import.meta.url);
const PHRASE = "quick brown fox jumps over the lazy dog";

function sectionMetadata(publication: Publication, spineIndex: number): SectionMetadata {
  const link = publication.readingOrder[spineIndex]!;
  return {
    href: link.href,
    spineIndex,
    spineLength: publication.readingOrder.length,
    ...(link.mediaType ? { mediaType: link.mediaType } : {}),
    ...(link.title ? { title: link.title } : {}),
  };
}

function textNodeContaining(document: Document, phrase: string): Text {
  const root = document.body ?? document.documentElement;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if ((node.nodeValue ?? "").includes(phrase)) return node as Text;
    node = walker.nextNode();
  }
  throw new Error(`Fixture phrase not found: ${phrase}`);
}

describe("happy-dom EPUB server harness", () => {
  it("round-trips a real fixture range CFI in a Node environment", async () => {
    expect(typeof document).toBe("undefined");

    await withEpubServerDom(async () => {
      expect(globalThis.DOMParser).toBeDefined();
      expect(globalThis.Node).toBeDefined();
      expect(typeof document.createRange).toBe("function");
      expect(typeof document.createTreeWalker).toBe("function");

      const fixture = await readFile(FIXTURE_URL);
      const provider = await openZipResourceProvider(
        fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength),
      );
      try {
        const { publication } = await openPublication(provider);
        expect(publication).not.toBeNull();
        if (!publication) throw new Error("Fixture publication did not open");

        const spineIndex = 0;
        const source = await provider.readText(publication.readingOrder[spineIndex]!.href);
        const spineDocument = parseEpubServerDocument(source);
        expect(spineDocument.getElementsByTagName("parsererror")).toHaveLength(0);

        const textNode = textNodeContaining(spineDocument, PHRASE);
        const start = textNode.data.indexOf(PHRASE);
        const range = spineDocument.createRange();
        range.setEnd(textNode, start + PHRASE.length);
        range.setStart(textNode, start);
        expect(range.startOffset).not.toBe(range.endOffset);

        const section = sectionMetadata(publication, spineIndex);
        const cfi = generateCfi(range, section);
        const resolved = resolveCfi(cfi, spineDocument, section);

        expect(parseCfi(cfi).kind).toBe("range");
        expect(resolved).not.toBeNull();
        expect(resolved?.startOffset).not.toBe(resolved?.endOffset);
        expect(resolved?.toString()).toBe(PHRASE);
      } finally {
        provider.close();
      }
    });
  });
});
