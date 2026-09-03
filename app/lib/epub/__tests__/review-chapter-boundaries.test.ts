// @vitest-environment node
import { strToU8, zipSync } from "fflate";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { extractBookChapters } from "../epub-text-extract";
import { ensureEpubServerDom } from "../server-dom";
import {
  buildReviewChapterBoundaries,
  collectReviewAnchorOffsets,
  reviewBoundaryContains,
} from "../review-chapter-boundaries";
import { fingerprintReviewChapter } from "~/lib/review/chapter-identity";
import { logicalChapterIndex } from "../successor-toc";

const xhtml = (body: string) =>
  `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Test</title></head><body>${body}</body></html>`;
function epub(
  options: {
    missingAnchor?: boolean;
    missingSpine?: boolean;
    singleSpine?: boolean;
    noToc?: boolean;
  } = {},
): ArrayBuffer {
  const continuation = options.singleSpine ? "\n\nSecond continues." : "";
  const entries: Record<string, string> = {
    mimetype: "application/epub+zip",
    "META-INF/container.xml":
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    "EPUB/book.opf": `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">fixture</dc:identifier><dc:title>Fixture</dc:title><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="three" href="three.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/>${options.singleSpine ? "" : '<itemref idref="two"/>'}<itemref idref="three"/></spine></package>`,
    "EPUB/nav.xhtml": xhtml(
      `<nav epub:type="toc"><ol>${options.noToc ? "" : '<li><a href="one.xhtml">Part</a><ol><li><a href="one.xhtml#first">First</a></li><li><a href="one.xhtml#%73econd">Second</a></li><li><a href="one.xhtml#second">Duplicate target</a></li></ol></li><li><a href="three.xhtml#third">Third</a></li>'}</ol></nav>`,
    ),
    "EPUB/one.xhtml": xhtml(
      ` \n<h1 id="first">First</h1><p>First body.</p><h1 id="${options.missingAnchor ? "not-second" : "second"}">Second</h1><p>Second starts.${continuation}</p> \n`,
    ),
    "EPUB/two.xhtml": xhtml("<p>Second continues.</p>"),
    "EPUB/three.xhtml": xhtml('<h1 id="third">Third</h1><p>Third body.</p>'),
  };
  if (options.missingSpine) delete entries["EPUB/two.xhtml"];
  return Uint8Array.from(
    zipSync(
      Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, strToU8(value)])),
    ),
  ).buffer;
}
beforeAll(ensureEpubServerDom);

describe("review chapter boundaries", () => {
  it("subdivides same-spine TOC fragments and spans continuation files without changing legacy chapters", async () => {
    const chapters = await extractBookChapters(epub());
    expect(
      chapters.map(({ index, title, spineStart, spineEnd }) => ({
        index,
        title,
        spineStart,
        spineEnd,
      })),
    ).toEqual([
      { index: 0, title: "First", spineStart: 0, spineEnd: 2 },
      { index: 1, title: "Third", spineStart: 2, spineEnd: 3 },
    ]);
    const chapter = chapters[0]!;
    expect(chapter.text).toBe("FirstFirst body.SecondSecond starts.\n\nSecond continues.");
    expect(chapter.segments).toEqual([
      { spineIndex: 0, href: "EPUB/one.xhtml", start: 0, end: 36 },
      { spineIndex: 1, href: "EPUB/two.xhtml", start: 38, end: chapter.text.length },
    ]);
    const [first, second] = chapter.reviewBoundaries!;
    expect(chapter.reviewBoundaries).toHaveLength(2);
    expect(chapter.text.slice(first!.startOffset, first!.endOffset)).toBe("FirstFirst body.");
    expect(chapter.text.slice(second!.startOffset, second!.endOffset)).toBe(
      "SecondSecond starts.\n\nSecond continues.",
    );
    expect(first!.end).toEqual(second!.start);
    expect(second!.start).toMatchObject({ spineIndex: 0, fragment: "second", textOffset: 16 });
    expect(second!.end).toEqual({
      spineIndex: 2,
      href: "EPUB/three.xhtml",
      fragment: null,
      textOffset: 0,
    });
    expect(chapters[1]!.reviewBoundaries![0]!.end).toBeNull();

    const hrefs = ["EPUB/one.xhtml", "EPUB/two.xhtml", "EPUB/three.xhtml"];
    const book = {
      spine: {
        get(target?: string | number) {
          const index =
            typeof target === "number"
              ? target
              : hrefs.findIndex((href) => href === target?.split("#")[0]);
          return index >= 0 ? { index, href: hrefs[index] } : null;
        },
        each(fn: (section: { index: number; href: string }) => void) {
          hrefs.forEach((href, index) => fn({ index, href }));
        },
      },
    };
    expect(
      logicalChapterIndex(
        [
          { label: "First", href: "EPUB/one.xhtml#first" },
          { label: "Second", href: "EPUB/one.xhtml#second" },
          { label: "Third", href: "EPUB/three.xhtml#third" },
        ],
        book,
        1,
      ),
    ).toBe(0);
  });

  it("uses inclusive starts/exclusive ends for exact fragment positions and multi-spine backtracking", async () => {
    const chapter = (await extractBookChapters(epub()))[0]!;
    const [first, second] = chapter.reviewBoundaries!;
    expect(reviewBoundaryContains(first!, { spineIndex: 0, textOffset: 15 })).toBe(true);
    expect(reviewBoundaryContains(first!, second!.start)).toBe(false);
    expect(reviewBoundaryContains(second!, second!.start)).toBe(true);
    expect(reviewBoundaryContains(second!, { spineIndex: 1, textOffset: 3 })).toBe(true);
    expect(reviewBoundaryContains(second!, { spineIndex: 2, textOffset: 0 })).toBe(false);
  });

  it("has identical full-content fingerprints when a chapter is repackaged across spine files", async () => {
    const multi = (await extractBookChapters(epub()))[0]!;
    const single = (await extractBookChapters(epub({ singleSpine: true })))[0]!;
    const a = multi.reviewBoundaries![1]!;
    const b = single.reviewBoundaries![1]!;
    expect(await fingerprintReviewChapter(multi.text.slice(a.startOffset, a.endOffset))).toBe(
      await fingerprintReviewChapter(single.text.slice(b.startOffset, b.endOffset)),
    );
  });

  it("leaves unresolved or partially loaded chapters ineligible without breaking existing extraction", async () => {
    const missingAnchor = (await extractBookChapters(epub({ missingAnchor: true })))[0]!;
    expect(missingAnchor.text).toContain("Second continues.");
    expect(missingAnchor.reviewBoundaries).toEqual([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const partial = (await extractBookChapters(epub({ missingSpine: true })))[0]!;
      expect(partial.text).toContain("First body.");
      expect(partial.reviewBoundaries).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it("falls back to one boundary per nonempty spine when there is no TOC", async () => {
    const chapters = await extractBookChapters(epub({ noToc: true }));
    expect(chapters).toHaveLength(3);
    expect(chapters.map((chapter) => chapter.reviewBoundaries?.length)).toEqual([1, 1, 1]);
    expect(chapters.map((chapter) => chapter.reviewBoundaries![0]!.key)).toEqual([
      "review-v1:0:0",
      "review-v1:1:0",
      "review-v1:2:0",
    ]);
  });

  it("tracks nested and empty fragment anchors against trimmed UTF-16 source text", () => {
    const document = new DOMParser().parseFromString(
      xhtml(' \n<section id="one"><p>A😀</p><a name="empty"/><p id="two">B</p></section> \n'),
      "application/xhtml+xml",
    );
    expect(collectReviewAnchorOffsets(document)).toEqual({ one: 0, empty: 3, two: 3 });
  });

  it.each(["First body.", "First 😀 body."])(
    "retains separate fragment chapters after CDATA containing %s",
    (firstText) => {
      const document = new DOMParser().parseFromString(
        xhtml(' \n<p id="first"></p><h1 id="second">Second</h1><p>Second body.</p> \n'),
        "application/xhtml+xml",
      );
      // happy-dom cannot parse or create CDATA. Model its public CharacterData
      // surface to exercise source offsets for the native nodeType 4 case.
      const cdata = document.createTextNode(firstText);
      Object.defineProperty(cdata, "nodeType", { value: 4 });
      document.getElementById("first")!.appendChild(cdata);
      const text = document.body.textContent!.trim();
      expect(text).toBe(`${firstText}SecondSecond body.`);
      const anchors = collectReviewAnchorOffsets(document);
      expect(anchors).toEqual({ first: 0, second: firstText.length });
      const href = "one.xhtml";
      const boundaries = buildReviewChapterBoundaries(
        {
          index: 0,
          title: "First",
          text,
          spineStart: 0,
          spineEnd: 1,
          segments: [{ spineIndex: 0, href, start: 0, end: text.length }],
        },
        [
          { title: "First", href: `${href}#first` },
          { title: "Second", href: `${href}#second` },
        ],
        [{ href }],
        [{ index: 0, href, text, anchors }],
      );
      expect(boundaries).toHaveLength(2);
      expect(
        boundaries.map((boundary) => text.slice(boundary.startOffset, boundary.endOffset)),
      ).toEqual([firstText, "SecondSecond body."]);
      expect(boundaries[0]!.end).toEqual(boundaries[1]!.start);
      expect(boundaries[1]!.start.textOffset).toBe(firstText.length);
    },
  );
});
