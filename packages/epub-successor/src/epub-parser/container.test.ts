import { describe, expect, it } from "vitest";

import { parseContainerXml } from "./container";
import { XML_NAMESPACES } from "./xml";

function containerXml(rootfiles: string): string {
  return `<container xmlns="${XML_NAMESPACES.container}" version="1.0"><rootfiles>${rootfiles}</rootfiles></container>`;
}

describe("parseContainerXml", () => {
  it("parses and normalizes a valid rootfile path", () => {
    const result = parseContainerXml(
      containerXml(
        '<rootfile full-path="./OPS\\package.opf" media-type="application/oebps-package+xml"/>',
      ),
    );

    expect(result).toEqual({ rootfiles: ["OPS/package.opf"], diagnostics: [] });
  });

  it("returns multiple rootfiles in document order", () => {
    const result = parseContainerXml(
      containerXml(
        '<rootfile full-path="EPUB/package.opf"/><rootfile full-path="alternate/package.opf"/>',
      ),
    );

    expect(result.rootfiles).toEqual(["EPUB/package.opf", "alternate/package.opf"]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports malformed XML", () => {
    const result = parseContainerXml("<container>");

    expect(result.rootfiles).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe("XML_MALFORMED");
  });

  it("rejects a container in the wrong namespace", () => {
    const result = parseContainerXml(
      '<container xmlns="https://example.com/not-container"><rootfiles><rootfile full-path="package.opf"/></rootfiles></container>',
    );

    expect(result.rootfiles).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe("CONTAINER_WRONG_NAMESPACE");
  });

  it("reports a missing rootfile", () => {
    const result = parseContainerXml(containerXml(""));

    expect(result.rootfiles).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      code: "CONTAINER_MISSING_ROOTFILE",
      severity: "error",
      sourcePath: "META-INF/container.xml",
    });
  });

  it("reports invalid and missing full-path attributes", () => {
    const result = parseContainerXml(
      containerXml('<rootfile full-path="../package.opf"/><rootfile/>'),
    );

    expect(result.rootfiles).toEqual([]);
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      "CONTAINER_INVALID_ROOTFILE_PATH",
      "CONTAINER_ROOTFILE_MISSING_PATH",
    ]);
  });
});
