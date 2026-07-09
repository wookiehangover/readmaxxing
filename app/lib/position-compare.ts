import { EpubCFI } from "epubjs";

const PAGE_CFI_PATTERN = /^page:([0-9]+)$/;

function parsePageCfi(cfi: string): number | null {
  const match = PAGE_CFI_PATTERN.exec(cfi);
  if (!match) return null;

  const page = Number(match[1]);
  return Number.isSafeInteger(page) && page > 0 ? page : null;
}

export function isFurtherAlong(remoteCfi: string, localCfi: string): boolean {
  const remotePage = parsePageCfi(remoteCfi);
  const localPage = parsePageCfi(localCfi);

  if (remotePage !== null || localPage !== null) {
    return remotePage !== null && localPage !== null && remotePage > localPage;
  }

  try {
    const comparator = new EpubCFI();
    if (!comparator.isCfiString(remoteCfi) || !comparator.isCfiString(localCfi)) {
      return false;
    }
    return comparator.compare(remoteCfi, localCfi) > 0;
  } catch {
    return false;
  }
}
