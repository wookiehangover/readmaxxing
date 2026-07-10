export const EPUB_SUCCESSOR_PACKAGE_NAME = "@readmaxxing/epub-successor";

export { parseNavigationDocument } from "./epub-parser/nav";
export type { NavigationDocumentParseResult } from "./epub-parser/nav";
export { parseNcx } from "./epub-parser/ncx";
export type { NcxParseResult } from "./epub-parser/ncx";
export { openPublication } from "./epub-parser/publication";
export type {
  NavigationSource,
  OpenPublicationOptions,
  OpenPublicationResult,
} from "./epub-parser/publication";
export { createNavigator, Navigator } from "./navigator/navigator";
export type {
  CreateNavigatorOptions,
  DisplayTarget,
  NavigatorPreferences,
  Relocation,
} from "./navigator/navigator";
export {
  generateEphemeralPositions,
  locatorFromRange,
  resolveLocator,
} from "./locations/locations";
export type { MountedSection, PersistentLocator, SectionMetadata } from "./locations/locations";
export { generateCfi, parseCfi, resolveCfi } from "./locations/cfi";
export type { ParsedCfi } from "./locations/cfi";
export { normalizePublicationPath } from "./publication-model/paths";
export type { PublicationPath } from "./publication-model/paths";
export type { Link, Publication, TocEntry } from "./publication-model/publication-model";
export { openZipResourceProvider, ZipResourceProvider } from "./resource-loader/resource-loader";
export type { ResourceProvider } from "./resource-loader/resource-loader";
