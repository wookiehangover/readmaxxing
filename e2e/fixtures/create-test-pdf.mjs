/**
 * Generate a minimal valid PDF file for E2E testing.
 * Run: node e2e/fixtures/create-test-pdf.mjs
 *
 * Produces e2e/fixtures/test-document.pdf — a two-page PDF with title/author metadata.
 * This is a raw PDF 1.4 file built from scratch (no dependencies needed).
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// PDF content as string segments — we track byte offsets for the xref table
const objects = [];
let currentOffset = 0;

function addLine(line) {
  const bytes = Buffer.from(line + "\n", "binary");
  currentOffset += bytes.length;
  objects.push(bytes);
}

function getOffset() {
  return currentOffset;
}

// PDF header
addLine("%PDF-1.4");
addLine("%\xE2\xE3\xCF\xD3");

// Object 1: Catalog
const obj1Offset = getOffset();
addLine("1 0 obj");
addLine("<< /Type /Catalog /Pages 2 0 R >>");
addLine("endobj");

// Object 2: Pages
const obj2Offset = getOffset();
addLine("2 0 obj");
addLine("<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>");
addLine("endobj");

// Object 5: Font
const obj5Offset = getOffset();
addLine("5 0 obj");
addLine("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
addLine("endobj");

// Page 1 content
const page1Text = [
  "BT",
  "/F1 24 Tf",
  "72 700 Td",
  "(Test PDF for E2E) Tj",
  "0 -36 Td",
  "/F1 14 Tf",
  "(By Test PDF Author) Tj",
  "0 -28 Td",
  "/F1 12 Tf",
  "(This is the first page of our test PDF document.) Tj",
  "0 -20 Td",
  "(It contains enough text to verify that PDF import is working correctly.) Tj",
  "0 -20 Td",
  "(The quick brown fox jumps over the lazy dog.) Tj",
  "ET",
].join("\n");

const obj6Offset = getOffset();
addLine("6 0 obj");
addLine(`<< /Length ${page1Text.length} >>`);
addLine("stream");
addLine(page1Text);
addLine("endstream");
addLine("endobj");

// Object 3: Page 1
const obj3Offset = getOffset();
addLine("3 0 obj");
addLine(
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
);
addLine("endobj");

// Page 2 content
const page2Text = [
  "BT",
  "/F1 18 Tf",
  "72 700 Td",
  "(Page 2: Continued) Tj",
  "0 -28 Td",
  "/F1 12 Tf",
  "(This is the second page of the test PDF.) Tj",
  "0 -20 Td",
  "(Testing search functionality: the word elephant appears exactly once.) Tj",
  "ET",
].join("\n");

const obj7Offset = getOffset();
addLine("7 0 obj");
addLine(`<< /Length ${page2Text.length} >>`);
addLine("stream");
addLine(page2Text);
addLine("endstream");
addLine("endobj");

// Object 4: Page 2
const obj4Offset = getOffset();
addLine("4 0 obj");
addLine(
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 7 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
);
addLine("endobj");

// Object 8: Info dictionary (metadata)
const obj8Offset = getOffset();
addLine("8 0 obj");
addLine("<< /Title (Test PDF for E2E) /Author (Test PDF Author) /Creator (create-test-pdf.mjs) >>");
addLine("endobj");

// Cross-reference table
const xrefOffset = getOffset();
addLine("xref");
addLine("0 9");
addLine("0000000000 65535 f ");
addLine(`${String(obj1Offset).padStart(10, "0")} 00000 n `);
addLine(`${String(obj2Offset).padStart(10, "0")} 00000 n `);
addLine(`${String(obj3Offset).padStart(10, "0")} 00000 n `);
addLine(`${String(obj4Offset).padStart(10, "0")} 00000 n `);
addLine(`${String(obj5Offset).padStart(10, "0")} 00000 n `);
addLine(`${String(obj6Offset).padStart(10, "0")} 00000 n `);
addLine(`${String(obj7Offset).padStart(10, "0")} 00000 n `);
addLine(`${String(obj8Offset).padStart(10, "0")} 00000 n `);

// Trailer
addLine("trailer");
addLine("<< /Size 9 /Root 1 0 R /Info 8 0 R >>");
addLine("startxref");
addLine(String(xrefOffset));
addLine("%%EOF");

const pdf = Buffer.concat(objects);
const outPath = join(__dirname, "test-document.pdf");
writeFileSync(outPath, pdf);
console.log(`Created ${outPath} (${pdf.length} bytes)`);
