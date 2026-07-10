import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { openZipResourceProvider } from "../resource-loader/resource-loader";
import { openPublication } from "./publication";
import { XML_NAMESPACES } from "./xml";

function archive(entries: Record<string, string>): Uint8Array<ArrayBuffer> {
  return zipSync(
    Object.fromEntries(Object.entries(entries).map(([path, value]) => [path, strToU8(value)])),
  );
}

const CONTAINER = `<container xmlns="${XML_NAMESPACES.container}" version="1.0"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;

function packageDocument(navigationItem: string): string {
  return `<package xmlns="${XML_NAMESPACES.opf}" version="3.0">
    <metadata xmlns:dc="${XML_NAMESPACES.dc}"><dc:title>Fixture</dc:title><dc:language>en</dc:language></metadata>
    <manifest>
      <item id="chapter" href="text/chapter.xhtml" media-type="application/xhtml+xml"/>
      ${navigationItem}
    </manifest>
    <spine><itemref idref="chapter"/></spine>
  </package>`;
}

const NAVIGATION = `<html xmlns="${XML_NAMESPACES.xhtml}" xmlns:epub="${XML_NAMESPACES.epub}"><body>
  <nav epub:type="toc"><ol><li><a href="text/chapter.xhtml#nav">Navigation chapter</a></li></ol></nav>
</body></html>`;

const NCX = `<ncx xmlns="${XML_NAMESPACES.ncx}"><navMap><navPoint>
  <navLabel><text>NCX chapter</text></navLabel><content src="text/chapter.xhtml#ncx"/>
</navPoint></navMap></ncx>`;

describe("openPublication", () => {
  it("assembles an in-memory EPUB ZIP and prefers the EPUB 3 navigation document", async () => {
    const provider = await openZipResourceProvider(
      archive({
        "META-INF/container.xml": CONTAINER,
        "OPS/package.opf": packageDocument(`
          <item id="nav" href="navigation.xhtml" media-type="application/xhtml+xml" properties="nav"/>
          <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
        `),
        "OPS/navigation.xhtml": NAVIGATION,
        "OPS/toc.ncx": NCX,
        "OPS/text/chapter.xhtml": "<html/>",
      }).buffer,
    );

    try {
      const result = await openPublication(provider);

      expect(result.navigationSource).toBe("nav");
      expect(result.packagePath).toBe("OPS/package.opf");
      expect(result.publication?.metadata.title).toBe("Fixture");
      expect(result.publication?.toc).toEqual([
        {
          title: "Navigation chapter",
          href: "OPS/text/chapter.xhtml#nav",
          children: [],
        },
      ]);
    } finally {
      provider.close();
    }
  });

  it("falls back to NCX when the package has no EPUB 3 navigation item", async () => {
    const provider = await openZipResourceProvider(
      archive({
        "META-INF/container.xml": CONTAINER,
        "OPS/package.opf": packageDocument(
          '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
        ),
        "OPS/toc.ncx": NCX,
        "OPS/text/chapter.xhtml": "<html/>",
      }).buffer,
    );

    try {
      const result = await openPublication(provider);

      expect(result.navigationSource).toBe("ncx");
      expect(result.publication?.toc[0]).toEqual({
        title: "NCX chapter",
        href: "OPS/text/chapter.xhtml#ncx",
        children: [],
      });
    } finally {
      provider.close();
    }
  });
});
