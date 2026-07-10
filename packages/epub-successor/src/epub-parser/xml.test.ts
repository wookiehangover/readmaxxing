import { describe, expect, it } from "vitest";

import { normalizePublicationPath } from "../publication-model/paths";
import { getAttributeNS, getFirstElementNS, getTextContent, parseXml, XML_NAMESPACES } from "./xml";

const SOURCE_PATH = normalizePublicationPath("EPUB/package.opf");

describe("XML utilities", () => {
  it("parses XML and selects namespaced elements and attributes", () => {
    const result = parseXml(
      `<package xmlns="${XML_NAMESPACES.opf}" xmlns:dc="${XML_NAMESPACES.dc}" xmlns:epub="${XML_NAMESPACES.epub}"><metadata><dc:title epub:type="main-title">  A title  </dc:title></metadata></package>`,
      SOURCE_PATH,
    );

    const title = getFirstElementNS(result.document!, XML_NAMESPACES.dc, "title");
    expect(result.diagnostics).toEqual([]);
    expect(getTextContent(title)).toBe("A title");
    expect(getAttributeNS(title!, XML_NAMESPACES.epub, "type")).toBe("main-title");
  });

  it("reports malformed XML without returning a document", () => {
    const result = parseXml("<package>", SOURCE_PATH);

    expect(result.document).toBeNull();
    expect(result.diagnostics[0]).toMatchObject({
      code: "XML_MALFORMED",
      severity: "error",
      sourcePath: SOURCE_PATH,
    });
  });

  it("rejects document type declarations before parsing", () => {
    const result = parseXml('<!DOCTYPE package SYSTEM "external.dtd"><package/>', SOURCE_PATH);

    expect(result.document).toBeNull();
    expect(result.diagnostics[0]?.code).toBe("XML_FORBIDDEN_DECLARATION");
  });
});
