export const EPUB_SUCCESSOR_PACKAGE_NAME = "@readmaxxing/epub-successor";
export { assembleSectionDocument } from "./content-pipeline/content-pipeline";

export { createDecorationLayer, DecorationLayer } from "./decorations/decorations";
export type {
  Decoration,
  DecorationClickDetail,
  DecorationLayerEventMap,
  DecorationLayerOptions,
  DecorationRenderingMode,
  HighlightDecorationStyle,
  SelectionChangedDetail,
} from "./decorations/decorations";
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
export type { NavigatorNavigationPolicy } from "./navigator/navigation-policy";
export { contentRange, fragmentElement, rangeContainsRange } from "./navigator/content-range";
export type { NavigatorContentRange } from "./navigator/content-range";
export type {
  CreateNavigatorOptions,
  DisplayTarget,
  InteractivePageTurnDirection,
  NavigatorPreferences,
  Relocation,
} from "./navigator/navigator";
export { DEFAULT_MIN_SPREAD_WIDTH } from "./navigator/paginated";
export { visibleViewportText } from "./navigator/visible-text";
export type { VisibleViewportGeometry } from "./navigator/visible-text";
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
export { createCfi } from "./publication-model/publication-model";
export type {
  Cfi,
  Link,
  Locator,
  Publication,
  TocEntry,
} from "./publication-model/publication-model";
export { openZipResourceProvider, ZipResourceProvider } from "./resource-loader/resource-loader";
export type { ResourceProvider } from "./resource-loader/resource-loader";
