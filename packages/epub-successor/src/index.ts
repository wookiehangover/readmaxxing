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
