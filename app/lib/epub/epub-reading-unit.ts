import { visibleViewportText } from "@readmaxxing/epub-successor";
import type { ReadingDwellUnit } from "~/hooks/use-reader-dwell";

interface BuildEpubReadingUnitOptions {
  readonly href: string;
  readonly page: number;
  readonly chapterLabel?: string | null;
  readonly document?: Document | null;
}

export function buildEpubReadingUnit({
  href,
  page,
  chapterLabel,
  document,
}: BuildEpubReadingUnitOptions): ReadingDwellUnit {
  return {
    unitKind: "epub-spine",
    locator: `${href}#page=${page}`,
    chapterLabel: chapterLabel ?? undefined,
    text: document ? visibleViewportText(document) : "",
  };
}
