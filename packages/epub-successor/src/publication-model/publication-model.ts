import type { PublicationPath } from "./paths";

declare const cfiBrand: unique symbol;
declare const mediaTypeBrand: unique symbol;

export type Cfi = string & { readonly [cfiBrand]: "Cfi" };
export type MediaType = string & { readonly [mediaTypeBrand]: "MediaType" };

export function createCfi(value: string): Cfi {
  const cfi = value.trim();
  if (!cfi.startsWith("epubcfi(") || !cfi.endsWith(")")) {
    throw new TypeError("An EPUB CFI must use the epubcfi(...) form");
  }
  return cfi as Cfi;
}

export function createMediaType(value: string): MediaType {
  const mediaType = value.trim().toLowerCase();
  if (!/^[^\s/]+\/[^\s/]+$/.test(mediaType)) {
    throw new TypeError("A media type must use the type/subtype form");
  }
  return mediaType as MediaType;
}

export type TextDirection = "auto" | "ltr" | "rtl";
export type PageProgressionDirection = "default" | "ltr" | "rtl";

export interface Contributor {
  readonly name: string;
  readonly identifier?: string;
  readonly sortAs?: string;
}

export interface Presentation {
  readonly layout?: "fixed" | "reflowable";
  readonly flow?: "auto" | "paginated" | "scrolled-continuous" | "scrolled-doc";
  readonly orientation?: "auto" | "landscape" | "portrait";
  readonly spread?: "auto" | "both" | "landscape" | "none" | "portrait";
  readonly viewport?: Readonly<{ width: number; height: number }>;
}

export interface Metadata {
  readonly title: string;
  readonly languages: readonly string[];
  readonly identifier?: string;
  readonly authors: readonly Contributor[];
  readonly direction?: TextDirection;
  readonly pageProgressionDirection?: PageProgressionDirection;
  readonly presentation?: Presentation;
}

export interface Link {
  readonly href: PublicationPath;
  readonly mediaType?: MediaType;
  readonly rel: readonly string[];
  readonly properties: readonly string[];
  readonly title?: string;
}

export interface TocEntry {
  readonly title: string;
  readonly href: PublicationPath;
  readonly children: readonly TocEntry[];
}

export interface PublicationDiagnostic {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  readonly href?: PublicationPath;
}

export interface Publication {
  readonly metadata: Metadata;
  readonly readingOrder: readonly Link[];
  readonly resources: readonly Link[];
  readonly toc: readonly TocEntry[];
  readonly landmarks: readonly TocEntry[];
  readonly diagnostics: readonly PublicationDiagnostic[];
}

export interface LocatorLocations {
  readonly progression: number;
  readonly totalProgression: number;
  readonly cfi?: Cfi;
  readonly position?: number;
}

export interface LocatorText {
  readonly before?: string;
  readonly highlight?: string;
  readonly after?: string;
}

export interface Locator {
  readonly href: PublicationPath;
  readonly mediaType?: MediaType;
  readonly title?: string;
  readonly locations: LocatorLocations;
  readonly text: LocatorText;
}
