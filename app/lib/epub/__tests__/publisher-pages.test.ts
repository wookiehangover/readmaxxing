import { describe, expect, it } from "vitest";
import { normalizePublicationPath, type Link, type TocEntry } from "@readmaxxing/epub-successor";
import { buildPublisherPageMap, resolvePublisherPage } from "~/lib/epub/publisher-pages";

function link(href: string): Link {
  return {
    href: normalizePublicationPath(href),
    rel: [],
    properties: [],
  };
}

function page(title: string, href: string): TocEntry {
  return {
    title,
    href: normalizePublicationPath(href),
    children: [],
  };
}

describe("buildPublisherPageMap", () => {
  const readingOrder = [link("OPS/a.xhtml"), link("OPS/b.xhtml"), link("OPS/c.xhtml")];

  it("returns null for an empty page-list", () => {
    expect(buildPublisherPageMap([], readingOrder)).toBeNull();
  });

  it("maps numeric labels and ignores entries outside the spine", () => {
    const map = buildPublisherPageMap(
      [
        page("i", "OPS/front.xhtml#roman"),
        page("1", "OPS/a.xhtml#p1"),
        page("Page 12", "OPS/b.xhtml#p12"),
        page("13", "OPS/c.xhtml#p13"),
      ],
      readingOrder,
    );

    expect(map).not.toBeNull();
    expect(map!.totalPages).toBe(13);
    expect(map!.entries.map((entry) => entry.pageNumber)).toEqual([1, 12, 13]);
    expect(map!.entries.map((entry) => entry.spineIndex)).toEqual([0, 1, 2]);
    expect(map!.entries[0]?.fragment).toBe("p1");
  });
});

describe("resolvePublisherPage", () => {
  const readingOrder = [link("OPS/a.xhtml"), link("OPS/b.xhtml")];
  const map = buildPublisherPageMap(
    [
      page("1", "OPS/a.xhtml#p1"),
      page("2", "OPS/a.xhtml#p2"),
      page("3", "OPS/b.xhtml#p3"),
      page("4", "OPS/b.xhtml#p4"),
    ],
    readingOrder,
  )!;

  it("uses spine-local progression when no document is mounted", () => {
    expect(
      resolvePublisherPage(map, {
        href: "OPS/a.xhtml",
        spineIndex: 0,
        localProgression: 0,
      }),
    ).toEqual({ currentPage: 1, totalPages: 4 });

    expect(
      resolvePublisherPage(map, {
        href: "OPS/a.xhtml",
        spineIndex: 0,
        localProgression: 0.9,
      }),
    ).toEqual({ currentPage: 2, totalPages: 4 });

    expect(
      resolvePublisherPage(map, {
        href: "OPS/b.xhtml",
        spineIndex: 1,
        localProgression: 0,
      }),
    ).toEqual({ currentPage: 3, totalPages: 4 });
  });

  it("falls back to progression when the document has no layout metrics", () => {
    const document = new DOMParser().parseFromString(
      `<html><body>
        <span id="p3">three</span>
        <span id="p4">four</span>
      </body></html>`,
      "text/html",
    );

    // happy-dom documents report 0×0 client size → progression path.
    expect(
      resolvePublisherPage(map, {
        href: "OPS/b.xhtml",
        spineIndex: 1,
        localProgression: 0,
        document,
      }),
    ).toEqual({ currentPage: 3, totalPages: 4 });
  });

  it("uses viewport geometry when layout metrics are available", () => {
    const document = new DOMParser().parseFromString(
      `<html><body>
        <span id="p3">three</span>
        <span id="p4">four</span>
      </body></html>`,
      "text/html",
    );
    Object.defineProperty(document.documentElement, "clientWidth", { value: 800 });
    Object.defineProperty(document.documentElement, "clientHeight", { value: 600 });

    const p3 = document.getElementById("p3")!;
    const p4 = document.getElementById("p4")!;
    p3.getBoundingClientRect = () =>
      ({
        top: 0,
        left: 0,
        bottom: 20,
        right: 40,
        width: 40,
        height: 20,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    // p4 is on the next column / below the fold — not yet reached.
    p4.getBoundingClientRect = () =>
      ({
        top: 0,
        left: 900,
        bottom: 20,
        right: 940,
        width: 40,
        height: 20,
        x: 900,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    expect(
      resolvePublisherPage(map, {
        href: "OPS/b.xhtml",
        spineIndex: 1,
        localProgression: 0.2,
        document,
      }),
    ).toEqual({ currentPage: 3, totalPages: 4 });
  });
});
