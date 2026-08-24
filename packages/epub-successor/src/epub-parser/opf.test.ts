import { describe, expect, it } from "vitest";

import { normalizePublicationPath } from "../publication-model/paths";
import { parseEncryptionXml, parseOpf } from "./opf";
import { XML_NAMESPACES } from "./xml";

const OPF_PATH = normalizePublicationPath("EPUB/package.opf");

function opf(body: string, attributes = 'version="3.0" unique-identifier="pub-id"'): string {
  return `<package xmlns="${XML_NAMESPACES.opf}" ${attributes}>${body}</package>`;
}

describe("parseOpf", () => {
  it("parses EPUB 3 metadata, rendition hints, manifest properties, and spine order", () => {
    const result = parseOpf(
      opf(`
        <metadata xmlns:dc="${XML_NAMESPACES.dc}">
          <dc:identifier id="other-id">other</dc:identifier>
          <dc:identifier id="pub-id">urn:isbn:9780000000000</dc:identifier>
          <dc:title id="subtitle">A Subtitle</dc:title>
          <dc:title id="main-title">The Main Title</dc:title>
          <meta refines="#main-title" property="title-type">main</meta>
          <dc:creator id="creator">Ada Author</dc:creator>
          <meta refines="#creator" property="role">aut</meta>
          <meta refines="#creator" property="file-as">Author, Ada</meta>
          <dc:language>en</dc:language>
          <dc:language>fr</dc:language>
          <meta property="rendition:layout">pre-paginated</meta>
          <meta property="rendition:flow">paginated</meta>
          <meta property="rendition:orientation">landscape</meta>
          <meta property="rendition:spread">both</meta>
          <meta property="rendition:viewport">width=1200, height=1600</meta>
        </metadata>
        <manifest>
          <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
          <item id="cover" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
          <item id="one" href="text/one.xhtml" media-type="application/xhtml+xml"/>
          <item id="two" href="text/two.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine page-progression-direction="rtl">
          <itemref idref="one"/>
          <itemref idref="two" linear="no" properties="page-spread-left"/>
        </spine>
        <bindings><mediaType media-type="application/x-custom" handler="one"/></bindings>
      `),
      OPF_PATH,
    );

    expect(result.publication?.metadata).toEqual({
      title: "The Main Title",
      identifier: "urn:isbn:9780000000000",
      languages: ["en", "fr"],
      authors: [{ name: "Ada Author", roles: ["aut"], sortAs: "Author, Ada" }],
      pageProgressionDirection: "rtl",
      presentation: {
        layout: "fixed",
        flow: "paginated",
        orientation: "landscape",
        spread: "both",
        viewport: { width: 1200, height: 1600 },
      },
    });
    expect(result.publication?.readingOrder).toMatchObject([
      { href: "EPUB/text/one.xhtml", linear: true },
      { href: "EPUB/text/two.xhtml", linear: false, properties: ["page-spread-left"] },
    ]);
    expect(result.manifest.get("nav")).toMatchObject({
      href: "EPUB/nav.xhtml",
      rel: ["contents"],
      properties: ["nav"],
    });
    expect(result.manifest.get("cover")?.rel).toEqual(["cover"]);
    expect(result.diagnostics.map(({ code }) => code)).toContain("OPF_BINDINGS_UNSUPPORTED");
  });

  it("normalizes EPUB 2 metadata and cover conventions", () => {
    const result = parseOpf(
      opf(
        `<metadata xmlns:dc="${XML_NAMESPACES.dc}" xmlns:opf="${XML_NAMESPACES.opf}">
          <dc:identifier id="book-id">book-2</dc:identifier>
          <dc:title>EPUB Two</dc:title>
          <dc:creator opf:role="aut" opf:file-as="Writer, Example">Example Writer</dc:creator>
          <dc:language>en-US</dc:language>
          <meta name="cover" content="cover-image"/>
          <meta name="rendition:layout" content="reflowable"/>
        </metadata>
        <manifest>
          <item id="cover-image" href="cover.png" media-type="image/png"/>
          <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine><itemref idref="chapter"/></spine>`,
        'version="2.0" unique-identifier="book-id"',
      ),
      OPF_PATH,
    );

    expect(result.publication?.metadata).toMatchObject({
      title: "EPUB Two",
      identifier: "book-2",
      languages: ["en-US"],
      authors: [{ name: "Example Writer", roles: ["aut"], sortAs: "Writer, Example" }],
      presentation: { layout: "reflowable" },
    });
    expect(result.manifest.get("cover-image")).toMatchObject({
      properties: ["cover-image"],
      rel: ["cover"],
    });
  });

  it("resolves fallback chains and tolerates duplicate and missing spine references", () => {
    const result = parseOpf(
      opf(`<metadata xmlns:dc="${XML_NAMESPACES.dc}">
          <dc:title>Fallbacks</dc:title><dc:language>en</dc:language>
        </metadata>
        <manifest>
          <item id="svg" href="chapter.svg" media-type="image/svg+xml" fallback="html"/>
          <item id="html" href="chapter.xhtml" media-type="application/xhtml+xml" fallback="plain"/>
          <item id="plain" href="chapter.txt" media-type="text/plain"/>
        </manifest>
        <spine>
          <itemref idref="svg"/><itemref idref="svg" linear="no"/><itemref idref="missing"/>
        </spine>`),
      OPF_PATH,
    );

    expect(result.fallbackChains.get("svg")?.map(({ href }) => href)).toEqual([
      "EPUB/chapter.xhtml",
      "EPUB/chapter.txt",
    ]);
    expect(result.publication?.readingOrder).toMatchObject([
      { href: "EPUB/chapter.svg", linear: true },
      { href: "EPUB/chapter.svg", linear: false },
    ]);
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      "OPF_DUPLICATE_SPINE_REF",
      "OPF_MISSING_SPINE_ITEM",
    ]);
  });

  it("terminates fallback cycles with a diagnostic", () => {
    const result = parseOpf(
      opf(`<metadata xmlns:dc="${XML_NAMESPACES.dc}"><dc:title>Cycle</dc:title></metadata>
        <manifest>
          <item id="a" href="a.xhtml" media-type="application/xhtml+xml" fallback="b"/>
          <item id="b" href="b.xhtml" media-type="application/xhtml+xml" fallback="a"/>
        </manifest><spine><itemref idref="a"/></spine>`),
      OPF_PATH,
    );

    expect(result.fallbackChains.get("a")?.map(({ href }) => href)).toEqual(["EPUB/b.xhtml"]);
    expect(result.diagnostics.map(({ code }) => code)).toContain("OPF_FALLBACK_CYCLE");
  });

  it("reports malformed package XML without throwing", () => {
    const result = parseOpf("<package>", OPF_PATH);

    expect(result.publication).toBeNull();
    expect(result.diagnostics[0]?.code).toBe("XML_MALFORMED");
  });
});

describe("parseEncryptionXml", () => {
  it("recognizes IDPF and Adobe font obfuscation as deferred metadata", () => {
    const result =
      parseEncryptionXml(`<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
      xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
      <enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
        <enc:CipherData><enc:CipherReference URI="EPUB/fonts/idpf.otf"/></enc:CipherData>
      </enc:EncryptedData>
      <enc:EncryptedData><enc:EncryptionMethod Algorithm="http://ns.adobe.com/pdf/enc#RC"/>
        <enc:CipherData><enc:CipherReference URI="EPUB/fonts/adobe.otf"/></enc:CipherData>
      </enc:EncryptedData>
    </encryption>`);

    expect(result.entries).toMatchObject([
      { href: "EPUB/fonts/idpf.otf", kind: "idpf-font-obfuscation" },
      { href: "EPUB/fonts/adobe.otf", kind: "adobe-font-obfuscation" },
    ]);
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      "ENCRYPTION_FONT_OBFUSCATION_DEFERRED",
      "ENCRYPTION_FONT_OBFUSCATION_DEFERRED",
    ]);
  });
});
