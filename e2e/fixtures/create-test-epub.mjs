/**
 * Generate minimal valid EPUB 3 files for E2E testing.
 * Run: node e2e/fixtures/create-test-epub.mjs
 *
 * Produces:
 *   e2e/fixtures/test-book.epub   — primary fixture, "Test Book for E2E"
 *   e2e/fixtures/test-book-2.epub — secondary fixture used by layout-modes
 *     tests that need a second distinct book (different title + identifier,
 *     so the file hash differs and the app treats it as a separate book).
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// CRC-32 lookup table
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[i] = c;
}
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(entries) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf-8");
    const dataBytes = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
    const local = Buffer.alloc(30 + nameBytes.length + dataBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    const crc = crc32(dataBytes);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dataBytes.length, 18);
    local.writeUInt32LE(dataBytes.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);
    dataBytes.copy(local, 30 + nameBytes.length);
    localHeaders.push(local);
    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(dataBytes.length, 20);
    central.writeUInt32LE(dataBytes.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);
    centralHeaders.push(central);
    offset += local.length;
  }
  const centralDir = Buffer.concat(centralHeaders);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localHeaders, centralDir, eocd]);
}

const mimetype = "application/epub+zip";

const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:12345678-1234-1234-1234-123456789abc</dc:identifier>
    <dc:title>Test Book for E2E</dc:title>
    <dc:creator>Test Author</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2024-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`;

const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Navigation</title></head>
<body>
<nav epub:type="toc" id="toc">
  <h1>Table of Contents</h1>
  <ol>
    <li><a href="chapter1.xhtml">Chapter 1: The Beginning</a></li>
    <li><a href="chapter2.xhtml">Chapter 2: The End</a></li>
  </ol>
</nav>
</body>
</html>`;

const chapter1 = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 1</title></head>
<body>
<h1>Chapter 1: The Beginning</h1>
<p>This is the first chapter of our test book. It contains enough text to verify that the epub reader is working correctly.</p>
<p>The quick brown fox jumps over the lazy dog. This sentence contains every letter of the alphabet.</p>
<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>
</body>
</html>`;

const chapter2 = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 2</title></head>
<body>
<h1>Chapter 2: The End</h1>
<p>This is the second and final chapter. It concludes our brief test book.</p>
<p>Testing search functionality: the word elephant appears exactly once in this book.</p>
</body>
</html>`;

const entries = [
  { name: "mimetype", data: mimetype },
  { name: "META-INF/container.xml", data: container },
  { name: "OEBPS/content.opf", data: opf },
  { name: "OEBPS/nav.xhtml", data: nav },
  { name: "OEBPS/chapter1.xhtml", data: chapter1 },
  { name: "OEBPS/chapter2.xhtml", data: chapter2 },
];

const epub = createZip(entries);
const outPath = join(__dirname, "test-book.epub");
writeFileSync(outPath, epub);
console.log(`Created ${outPath} (${epub.length} bytes)`);

// --- Second fixture ---------------------------------------------------------
// Minimal sibling book with a different title + identifier so its file hash
// does not collide with test-book.epub. Used by layout-modes.spec.ts to open
// two distinct books and verify cluster-switching behavior.

const opf2 = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:abcdef01-2345-6789-abcd-ef0123456789</dc:identifier>
    <dc:title>Second Test Book</dc:title>
    <dc:creator>Another Author</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2024-01-02T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
  </spine>
</package>`;

const nav2 = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Navigation</title></head>
<body>
<nav epub:type="toc" id="toc">
  <h1>Table of Contents</h1>
  <ol>
    <li><a href="chapter1.xhtml">Only Chapter</a></li>
  </ol>
</nav>
</body>
</html>`;

const chapter1b = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Only Chapter</title></head>
<body>
<h1>Only Chapter</h1>
<p>This book exists solely so end-to-end tests can open two distinct books at once.</p>
<p>The word zebra appears here so fuzzy searches across books can be distinguished.</p>
</body>
</html>`;

const entries2 = [
  { name: "mimetype", data: mimetype },
  { name: "META-INF/container.xml", data: container },
  { name: "OEBPS/content.opf", data: opf2 },
  { name: "OEBPS/nav.xhtml", data: nav2 },
  { name: "OEBPS/chapter1.xhtml", data: chapter1b },
];

const epub2 = createZip(entries2);
const outPath2 = join(__dirname, "test-book-2.epub");
writeFileSync(outPath2, epub2);
console.log(`Created ${outPath2} (${epub2.length} bytes)`);
