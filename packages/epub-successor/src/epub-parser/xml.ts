import type { PublicationPath } from "../publication-model/paths";

export const XML_NAMESPACES = {
  container: "urn:oasis:names:tc:opendocument:xmlns:container",
  dc: "http://purl.org/dc/elements/1.1/",
  epub: "http://www.idpf.org/2007/ops",
  ncx: "http://www.daisy.org/z3986/2005/ncx/",
  opf: "http://www.idpf.org/2007/opf",
  xhtml: "http://www.w3.org/1999/xhtml",
} as const;

export interface ParseDiagnostic {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  readonly sourcePath: PublicationPath;
}

export interface XmlParseResult {
  readonly document: Document | null;
  readonly diagnostics: readonly ParseDiagnostic[];
}

const FORBIDDEN_DECLARATION = /<!(?:DOCTYPE|ENTITY)\b/i;

function diagnostic(code: string, message: string, sourcePath: PublicationPath): ParseDiagnostic {
  return { severity: "error", code, message, sourcePath };
}

export function parseXml(source: string, sourcePath: PublicationPath): XmlParseResult {
  if (FORBIDDEN_DECLARATION.test(source)) {
    return {
      document: null,
      diagnostics: [
        diagnostic(
          "XML_FORBIDDEN_DECLARATION",
          "XML document type and entity declarations are not allowed",
          sourcePath,
        ),
      ],
    };
  }

  const document = new DOMParser().parseFromString(source, "application/xml");
  const parserError =
    document.documentElement?.localName === "parsererror"
      ? document.documentElement
      : document.getElementsByTagName("parsererror").item(0);

  if (parserError) {
    return {
      document: null,
      diagnostics: [diagnostic("XML_MALFORMED", "XML document is malformed", sourcePath)],
    };
  }

  return { document, diagnostics: [] };
}

export function getElementsNS(
  parent: Document | Element,
  namespace: string,
  localName: string,
): readonly Element[] {
  return Array.from(parent.querySelectorAll("*")).filter(
    (element) => element.namespaceURI === namespace && element.localName === localName,
  );
}

export function getFirstElementNS(
  parent: Document | Element,
  namespace: string,
  localName: string,
): Element | undefined {
  return getElementsNS(parent, namespace, localName)[0];
}

export function getChildElementsNS(
  parent: Element,
  namespace: string,
  localName: string,
): readonly Element[] {
  return Array.from(parent.children).filter(
    (child) => child.namespaceURI === namespace && child.localName === localName,
  );
}

export function getAttributeNS(
  element: Element,
  namespace: string | null,
  localName: string,
): string | undefined {
  for (const attribute of element.attributes) {
    if (attribute.namespaceURI === namespace && attribute.localName === localName) {
      return attribute.value;
    }
    if (namespace === null && attribute.name === localName) return attribute.value;

    const separator = attribute.name.indexOf(":");
    if (
      namespace !== null &&
      separator > 0 &&
      attribute.name.slice(separator + 1) === localName &&
      resolveNamespacePrefix(element, attribute.name.slice(0, separator)) === namespace
    ) {
      return attribute.value;
    }
  }
  return undefined;
}

function resolveNamespacePrefix(element: Element, prefix: string): string | undefined {
  let current: Element | null = element;
  while (current) {
    const declaration = current.getAttribute(`xmlns:${prefix}`);
    if (declaration !== null) return declaration;
    current = current.parentElement;
  }
  return undefined;
}

export function getTextContent(element: Element | null | undefined): string | undefined {
  const text = element?.textContent?.trim();
  return text ? text : undefined;
}
