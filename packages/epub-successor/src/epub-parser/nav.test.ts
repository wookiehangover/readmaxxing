import { describe, expect, it } from "vitest";

import { normalizePublicationPath } from "../publication-model/paths";
import { parseNavigationDocument } from "./nav";
import { parseNcx } from "./ncx";
import { XML_NAMESPACES } from "./xml";

const NAV_PATH = normalizePublicationPath("OPS/nav/navigation.xhtml");
const NCX_PATH = normalizePublicationPath("OPS/toc.ncx");

function navigation(body: string): string {
  return `<html xmlns="${XML_NAMESPACES.xhtml}" xmlns:epub="${XML_NAMESPACES.epub}"><body>${body}</body></html>`;
}

describe("parseNavigationDocument", () => {
  it("parses nested TOC entries, fragments, landmarks, and page-list entries", () => {
    const result = parseNavigationDocument(
      navigation(`
        <nav epub:type="toc"><ol>
          <li><a href="../text/chapter.xhtml#start">Chapter</a><ol>
            <li><a href="../text/chapter.xhtml#part">Part</a></li>
          </ol></li>
        </ol></nav>
        <nav epub:type="landmarks"><ol>
          <li><a href="../text/chapter.xhtml">Body</a></li>
        </ol></nav>
        <nav epub:type="page-list"><ol>
          <li><a href="../text/chapter.xhtml#page-1">1</a></li>
        </ol></nav>
      `),
      NAV_PATH,
    );

    expect(result.toc).toEqual([
      {
        title: "Chapter",
        href: "OPS/text/chapter.xhtml#start",
        children: [{ title: "Part", href: "OPS/text/chapter.xhtml#part", children: [] }],
      },
    ]);
    expect(result.landmarks).toEqual([
      { title: "Body", href: "OPS/text/chapter.xhtml", children: [] },
    ]);
    expect(result.pageList).toEqual([
      { title: "1", href: "OPS/text/chapter.xhtml#page-1", children: [] },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it("returns diagnostics for malformed navigation without throwing", () => {
    const result = parseNavigationDocument(
      navigation('<nav epub:type="toc"><ol><li><a>Missing href</a></li></ol></nav>'),
      NAV_PATH,
    );

    expect(result.toc).toEqual([]);
    expect(result.diagnostics).toMatchObject([
      { severity: "warning", code: "NAV_INVALID_ENTRY", sourcePath: NAV_PATH },
    ]);
  });
});

describe("parseNcx", () => {
  it("parses nested navPoints in document order and tolerates playOrder variations", () => {
    const result = parseNcx(
      `<ncx xmlns="${XML_NAMESPACES.ncx}"><navMap>
        <navPoint playOrder="not-a-number">
          <navLabel><text>Chapter</text></navLabel><content src="text/chapter.xhtml#start"/>
          <navPoint><navLabel><text>Part</text></navLabel><content src="text/chapter.xhtml#part"/></navPoint>
        </navPoint>
      </navMap></ncx>`,
      NCX_PATH,
    );

    expect(result.toc).toEqual([
      {
        title: "Chapter",
        href: "OPS/text/chapter.xhtml#start",
        children: [{ title: "Part", href: "OPS/text/chapter.xhtml#part", children: [] }],
      },
    ]);
    expect(result.pageList).toEqual([]);
    expect(result.diagnostics).toMatchObject([{ code: "NCX_INVALID_PLAY_ORDER" }]);
  });

  it("parses NCX pageList pageTargets", () => {
    const result = parseNcx(
      `<ncx xmlns="${XML_NAMESPACES.ncx}">
        <navMap>
          <navPoint>
            <navLabel><text>Chapter</text></navLabel>
            <content src="text/chapter.xhtml"/>
          </navPoint>
        </navMap>
        <pageList>
          <pageTarget type="normal" value="1">
            <navLabel><text>1</text></navLabel>
            <content src="text/chapter.xhtml#p1"/>
          </pageTarget>
          <pageTarget type="normal" value="2">
            <navLabel><text>2</text></navLabel>
            <content src="text/chapter.xhtml#p2"/>
          </pageTarget>
        </pageList>
      </ncx>`,
      NCX_PATH,
    );

    expect(result.pageList).toEqual([
      { title: "1", href: "OPS/text/chapter.xhtml#p1", children: [] },
      { title: "2", href: "OPS/text/chapter.xhtml#p2", children: [] },
    ]);
  });
});
