import type {
  Publication,
  PublicationDiagnostic,
  TocEntry,
} from "../publication-model/publication-model";
import type { PublicationPath } from "../publication-model/paths";
import type { ResourceProvider } from "../resource-loader/resource-loader";
import { CONTAINER_PATH, parseContainerXml } from "./container";
import { parseNavigationDocument } from "./nav";
import { parseNcx } from "./ncx";
import { parseOpf, type OpfParseResult } from "./opf";
import type { ParseDiagnostic } from "./xml";

export type NavigationSource = "nav" | "ncx" | "none";

export interface OpenPublicationOptions {
  readonly signal?: AbortSignal;
}

export interface OpenPublicationResult {
  readonly publication: Publication | null;
  readonly navigationSource: NavigationSource;
  readonly pageList: readonly TocEntry[];
  readonly packagePath?: PublicationPath;
  readonly diagnostics: readonly ParseDiagnostic[];
}

function readDiagnostic(path: PublicationPath, cause: unknown): ParseDiagnostic {
  const detail = cause instanceof Error ? `: ${cause.message}` : "";
  return {
    severity: "error",
    code: "PUBLICATION_RESOURCE_READ_FAILED",
    message: `Could not read ${path}${detail}`,
    sourcePath: path,
  };
}

function publicationDiagnostics(
  diagnostics: readonly ParseDiagnostic[],
): readonly PublicationDiagnostic[] {
  return diagnostics.map(({ severity, code, message, sourcePath: href }) => ({
    severity,
    code,
    message,
    href,
  }));
}

async function readText(
  provider: ResourceProvider,
  path: PublicationPath,
  diagnostics: ParseDiagnostic[],
  signal?: AbortSignal,
): Promise<string | undefined> {
  try {
    return await provider.readText(path, signal);
  } catch (cause) {
    if (signal?.aborted) throw cause;
    diagnostics.push(readDiagnostic(path, cause));
    return undefined;
  }
}

async function loadNavigation(
  provider: ResourceProvider,
  opf: OpfParseResult,
  diagnostics: ParseDiagnostic[],
  signal?: AbortSignal,
): Promise<{
  toc: readonly TocEntry[];
  landmarks: readonly TocEntry[];
  pageList: readonly TocEntry[];
  source: NavigationSource;
}> {
  const links = [...opf.manifest.values()];
  let toc: readonly TocEntry[] = [];
  let landmarks: readonly TocEntry[] = [];
  let pageList: readonly TocEntry[] = [];
  let source: NavigationSource = "none";

  const navigationLink = links.find((link) => link.properties.includes("nav"));
  if (navigationLink) {
    const navSource = await readText(provider, navigationLink.href, diagnostics, signal);
    if (navSource !== undefined) {
      const parsed = parseNavigationDocument(navSource, navigationLink.href);
      diagnostics.push(...parsed.diagnostics);
      if (parsed.toc.length > 0) {
        toc = parsed.toc;
        landmarks = parsed.landmarks;
        source = "nav";
      }
      // Keep page-list even when TOC is empty or later filled from NCX.
      if (parsed.pageList.length > 0) pageList = parsed.pageList;
    }
  }

  const ncxLink = links.find(
    (link) => link.mediaType === "application/x-dtbncx+xml" || link.href.endsWith(".ncx"),
  );
  if (ncxLink && (toc.length === 0 || pageList.length === 0)) {
    const ncxSource = await readText(provider, ncxLink.href, diagnostics, signal);
    if (ncxSource !== undefined) {
      const parsed = parseNcx(ncxSource, ncxLink.href);
      diagnostics.push(...parsed.diagnostics);
      if (toc.length === 0 && parsed.toc.length > 0) {
        toc = parsed.toc;
        source = "ncx";
      }
      if (pageList.length === 0 && parsed.pageList.length > 0) {
        pageList = parsed.pageList;
      }
    }
  }

  if (toc.length === 0 && pageList.length === 0) {
    diagnostics.push({
      severity: "warning",
      code: "PUBLICATION_NAVIGATION_UNAVAILABLE",
      message: "Publication has no usable EPUB navigation document or NCX",
      sourcePath: navigationLink?.href ?? ncxLink?.href ?? CONTAINER_PATH,
    });
  }

  return { toc, landmarks, pageList, source };
}

export async function openPublication(
  provider: ResourceProvider,
  options: OpenPublicationOptions = {},
): Promise<OpenPublicationResult> {
  const diagnostics: ParseDiagnostic[] = [];
  const containerSource = await readText(provider, CONTAINER_PATH, diagnostics, options.signal);
  if (containerSource === undefined) {
    return { publication: null, navigationSource: "none", pageList: [], diagnostics };
  }
  const container = parseContainerXml(containerSource);
  diagnostics.push(...container.diagnostics);
  const packagePath = container.rootfiles[0];
  if (!packagePath) {
    return { publication: null, navigationSource: "none", pageList: [], diagnostics };
  }

  const packageSource = await readText(provider, packagePath, diagnostics, options.signal);
  if (packageSource === undefined) {
    return {
      publication: null,
      navigationSource: "none",
      pageList: [],
      packagePath,
      diagnostics,
    };
  }
  const opf = parseOpf(packageSource, packagePath);
  diagnostics.push(...opf.diagnostics);
  if (!opf.publication) {
    return {
      publication: null,
      navigationSource: "none",
      pageList: [],
      packagePath,
      diagnostics,
    };
  }

  const navigation = await loadNavigation(provider, opf, diagnostics, options.signal);
  const publication: Publication = {
    ...opf.publication,
    toc: navigation.toc,
    landmarks: navigation.landmarks,
    diagnostics: publicationDiagnostics(diagnostics),
  };
  return {
    publication,
    navigationSource: navigation.source,
    pageList: navigation.pageList,
    packagePath,
    diagnostics,
  };
}
