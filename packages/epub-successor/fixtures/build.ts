import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { strToU8, zipSync, type Zippable } from "fflate";

// ZIP DOS timestamps are timezone-free, and fflate serializes Date's local fields.
const FIXED_MTIME = new Date(2000, 0, 1, 0, 0, 0);
const XHTML = "http://www.w3.org/1999/xhtml";
const OPF = "http://www.idpf.org/2007/opf";
const DC = "http://purl.org/dc/elements/1.1/";
const EPUB = "http://www.idpf.org/2007/ops";
const CONTAINER = "urn:oasis:names:tc:opendocument:xmlns:container";
const NCX = "http://www.daisy.org/z3986/2005/ncx/";

export const VALID_FIXTURE_NAMES = [
  "minimal-epub3.epub",
  "minimal-epub2.epub",
  "rtl.epub",
  "embedded-font.epub",
  "nested-paths.epub",
  "duplicate-spine.epub",
  "images.epub",
] as const;

export const MALICIOUS_FIXTURE_NAMES = [
  "path-traversal.epub",
  "high-compression-ratio.epub",
  "extreme-entry-count.epub",
  "script-content.epub",
  "external-references.epub",
  "meta-refresh.epub",
] as const;

type EntryValue = string | Uint8Array;
type Entries = Readonly<Record<string, EntryValue>>;

interface Epub3Options {
  readonly title: string;
  readonly packagePath?: string;
  readonly chapterPath?: string;
  readonly chapter?: string;
  readonly manifestExtra?: string;
  readonly spineAttributes?: string;
  readonly spineItems?: string;
  readonly extras?: Entries;
}

function container(packagePath: string): string {
  return `<?xml version="1.0"?><container xmlns="${CONTAINER}" version="1.0"><rootfiles><rootfile full-path="${packagePath}" media-type="application/oebps-package+xml"/></rootfiles></container>`;
}

function xhtml(body: string, head = "<title>Fixture</title>", language = "en"): string {
  return `<?xml version="1.0"?><html xmlns="${XHTML}" xml:lang="${language}"><head>${head}</head><body>${body}</body></html>`;
}

function directory(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash + 1);
}

function relativeFromPackage(packagePath: string, resourcePath: string): string {
  const base = directory(packagePath);
  if (!resourcePath.startsWith(base)) throw new Error(`${resourcePath} is outside ${base}`);
  return resourcePath.slice(base.length);
}

function epub3Entries(options: Epub3Options): Entries {
  const packagePath = options.packagePath ?? "EPUB/package.opf";
  const chapterPath = options.chapterPath ?? `${directory(packagePath)}text/chapter.xhtml`;
  const navPath = `${directory(packagePath)}nav.xhtml`;
  const chapterHref = relativeFromPackage(packagePath, chapterPath);
  const navHref = relativeFromPackage(packagePath, navPath);
  const spineItems = options.spineItems ?? '<itemref idref="chapter"/>';
  const packageDocument = `<?xml version="1.0"?><package xmlns="${OPF}" version="3.0" unique-identifier="pub-id"><metadata xmlns:dc="${DC}"><dc:identifier id="pub-id">urn:fixture:${options.title}</dc:identifier><dc:title>${options.title}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2000-01-01T00:00:00Z</meta></metadata><manifest><item id="chapter" href="${chapterHref}" media-type="application/xhtml+xml"/><item id="nav" href="${navHref}" media-type="application/xhtml+xml" properties="nav"/>${options.manifestExtra ?? ""}</manifest><spine ${options.spineAttributes ?? ""}>${spineItems}</spine></package>`;
  const nav = xhtml(
    `<nav xmlns:epub="${EPUB}" epub:type="toc"><ol><li><a href="${chapterHref}#start">Chapter</a></li></ol></nav>`,
  );
  return {
    mimetype: "application/epub+zip",
    "META-INF/container.xml": container(packagePath),
    [packagePath]: packageDocument,
    [navPath]: nav,
    [chapterPath]: options.chapter ?? xhtml('<h1 id="start">Fixture</h1><p>Text.</p>'),
    ...options.extras,
  };
}

function minimalEpub2Entries(): Entries {
  const packagePath = "OEBPS/content.opf";
  return {
    mimetype: "application/epub+zip",
    "META-INF/container.xml": container(packagePath),
    [packagePath]: `<?xml version="1.0"?><package xmlns="${OPF}" version="2.0" unique-identifier="pub-id"><metadata xmlns:dc="${DC}"><dc:identifier id="pub-id">urn:fixture:epub2</dc:identifier><dc:title>Minimal EPUB 2</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"><itemref idref="chapter"/></spine></package>`,
    "OEBPS/chapter.xhtml": xhtml('<h1 id="start">EPUB 2</h1>'),
    "OEBPS/toc.ncx": `<?xml version="1.0"?><ncx xmlns="${NCX}" version="2005-1"><head><meta name="dtb:uid" content="urn:fixture:epub2"/></head><docTitle><text>Minimal EPUB 2</text></docTitle><navMap><navPoint id="chapter"><navLabel><text>Chapter</text></navLabel><content src="chapter.xhtml#start"/></navPoint></navMap></ncx>`,
  };
}

function archive(entries: Entries): Uint8Array<ArrayBuffer> {
  const zippable: Zippable = {};
  for (const [path, value] of Object.entries(entries)) {
    const bytes = typeof value === "string" ? strToU8(value) : value;
    zippable[path] = [bytes, { level: path === "mimetype" ? 0 : 9, mtime: FIXED_MTIME }];
  }
  return zipSync(zippable, { level: 9, mtime: FIXED_MTIME });
}

function extremeEntryCount(): Entries {
  const entries: Record<string, EntryValue> = {};
  for (let index = 0; index <= 10_000; index += 1) {
    entries[`entries/${index.toString().padStart(5, "0")}.txt`] = "";
  }
  return entries;
}

const ONE_PIXEL_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);

/**
 * Builds byte-identical archives. The traversal, compression-ratio, and entry-count
 * fixtures are intentionally EPUBCheck-invalid ZIP/security probes. The scripted
 * fixture intentionally omits the EPUB `scripted` manifest property, while the
 * external-reference and meta-refresh fixtures intentionally contain content that
 * violates this library's scriptless/offline policy.
 */
export function buildFixtureArchives(): Readonly<Record<string, Uint8Array<ArrayBuffer>>> {
  const scripted = xhtml(
    '<script>alert("script")</script><main onclick="alert(\'handler\')"><a href="javascript:alert(\'url\')">unsafe</a><svg xmlns="http://www.w3.org/2000/svg"><script>alert("svg")</script><circle cx="1" cy="1" r="1"/></svg></main>',
  );
  const external = xhtml(
    '<link rel="stylesheet" href="https://example.invalid/book.css"/><img src="https://example.invalid/cover.png" alt="external"/><a href="https://example.invalid/leave">leave</a>',
  );
  const refresh = xhtml(
    "<p>Refresh must be removed.</p>",
    '<title>Refresh</title><meta http-equiv="refresh" content="0;url=https://example.invalid/escape"/>',
  );

  return {
    "minimal-epub3.epub": archive(epub3Entries({ title: "Minimal EPUB 3" })),
    "minimal-epub2.epub": archive(minimalEpub2Entries()),
    "rtl.epub": archive(
      epub3Entries({
        title: "RTL",
        spineAttributes: 'page-progression-direction="rtl"',
        chapter: xhtml('<h1 id="start">עברית</h1><p>مرحبا بالعالم</p>', "<title>RTL</title>", "he"),
      }),
    ),
    "embedded-font.epub": archive(
      epub3Entries({
        title: "Embedded Font",
        manifestExtra:
          '<item id="style" href="styles/book.css" media-type="text/css"/><item id="font" href="fonts/fixture.woff" media-type="font/woff"/>',
        chapter: xhtml(
          '<h1 id="start">Embedded font</h1>',
          '<title>Font</title><link rel="stylesheet" href="../styles/book.css"/>',
        ),
        extras: {
          "EPUB/styles/book.css":
            '@font-face{font-family:"Fixture";src:url("../fonts/fixture.woff") format("woff")}body{font-family:"Fixture"}',
          "EPUB/fonts/fixture.woff": strToU8("wOFFfixture"),
        },
      }),
    ),
    "nested-paths.epub": archive(
      epub3Entries({
        title: "Nested Paths",
        packagePath: "publication/package/metadata/content.opf",
        chapterPath: "publication/package/metadata/chapters/part/one.xhtml",
      }),
    ),
    "duplicate-spine.epub": archive(
      epub3Entries({
        title: "Duplicate Spine",
        spineItems: '<itemref idref="chapter"/><itemref idref="chapter"/>',
      }),
    ),
    "images.epub": archive(
      epub3Entries({
        title: "Images",
        manifestExtra: '<item id="pixel" href="images/pixel.png" media-type="image/png"/>',
        chapter: xhtml('<h1 id="start">Image</h1><img src="../images/pixel.png" alt="pixel"/>'),
        extras: { "EPUB/images/pixel.png": ONE_PIXEL_PNG },
      }),
    ),
    "path-traversal.epub": archive({ "../escape.txt": "unsafe" }),
    "high-compression-ratio.epub": archive({ "bomb.txt": "0".repeat(100_000) }),
    "extreme-entry-count.epub": archive(extremeEntryCount()),
    "script-content.epub": archive(epub3Entries({ title: "Script Content", chapter: scripted })),
    "external-references.epub": archive(
      epub3Entries({ title: "External References", chapter: external }),
    ),
    "meta-refresh.epub": archive(epub3Entries({ title: "Meta Refresh", chapter: refresh })),
  };
}

export async function writeFixtureArchives(
  outputDirectory = dirname(fileURLToPath(import.meta.url)),
) {
  await mkdir(outputDirectory, { recursive: true });
  const fixtures = buildFixtureArchives();
  await Promise.all(
    Object.entries(fixtures).map(([name, bytes]) => writeFile(join(outputDirectory, name), bytes)),
  );
  return fixtures;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) {
  const fixtures = await writeFixtureArchives();
  console.log(`Wrote ${Object.keys(fixtures).length} deterministic EPUB fixtures.`);
}
