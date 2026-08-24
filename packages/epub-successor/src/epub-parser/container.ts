import {
  normalizePublicationPath,
  PublicationPathError,
  type PublicationPath,
} from "../publication-model/paths";
import {
  getAttributeNS,
  getChildElementsNS,
  parseXml,
  type ParseDiagnostic,
  XML_NAMESPACES,
} from "./xml";

export const CONTAINER_PATH = normalizePublicationPath("META-INF/container.xml");

export interface ContainerParseResult {
  readonly rootfiles: readonly PublicationPath[];
  readonly diagnostics: readonly ParseDiagnostic[];
}

function error(code: string, message: string): ParseDiagnostic {
  return { severity: "error", code, message, sourcePath: CONTAINER_PATH };
}

export function parseContainerXml(source: string): ContainerParseResult {
  const parsed = parseXml(source, CONTAINER_PATH);
  if (!parsed.document) return { rootfiles: [], diagnostics: parsed.diagnostics };

  const container = parsed.document.documentElement;
  if (container.localName !== "container") {
    return {
      rootfiles: [],
      diagnostics: [
        error("CONTAINER_INVALID_ROOT", "Container document must have a container root"),
      ],
    };
  }
  if (container.namespaceURI !== XML_NAMESPACES.container) {
    return {
      rootfiles: [],
      diagnostics: [
        error("CONTAINER_WRONG_NAMESPACE", "Container root uses an unexpected namespace"),
      ],
    };
  }

  const rootfilesElement = getChildElementsNS(container, XML_NAMESPACES.container, "rootfiles")[0];
  const rootfileElements = rootfilesElement
    ? getChildElementsNS(rootfilesElement, XML_NAMESPACES.container, "rootfile")
    : [];
  if (rootfileElements.length === 0) {
    return {
      rootfiles: [],
      diagnostics: [
        error("CONTAINER_MISSING_ROOTFILE", "Container document has no rootfile entries"),
      ],
    };
  }

  const rootfiles: PublicationPath[] = [];
  const diagnostics: ParseDiagnostic[] = [];
  for (const rootfile of rootfileElements) {
    const fullPath = getAttributeNS(rootfile, null, "full-path")?.trim();
    if (!fullPath) {
      diagnostics.push(
        error("CONTAINER_ROOTFILE_MISSING_PATH", "Container rootfile is missing full-path"),
      );
      continue;
    }

    try {
      rootfiles.push(normalizePublicationPath(fullPath));
    } catch (cause) {
      const detail = cause instanceof PublicationPathError ? `: ${cause.message}` : "";
      diagnostics.push(
        error("CONTAINER_INVALID_ROOTFILE_PATH", `Container rootfile path is invalid${detail}`),
      );
    }
  }

  return { rootfiles, diagnostics };
}
