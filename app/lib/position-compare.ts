import { parseCfi, type ParsedCfi } from "@readmaxxing/epub-successor";

const PAGE_CFI_PATTERN = /^page:([0-9]+)$/;

function parsePageCfi(cfi: string): number | null {
  const match = PAGE_CFI_PATTERN.exec(cfi);
  if (!match) return null;

  const page = Number(match[1]);
  return Number.isSafeInteger(page) && page > 0 ? page : null;
}

function comparePath(
  left: { readonly steps: readonly { readonly number: number }[]; readonly offset?: number },
  right: { readonly steps: readonly { readonly number: number }[]; readonly offset?: number },
): number {
  const length = Math.min(left.steps.length, right.steps.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.steps[index]!.number - right.steps[index]!.number;
    if (difference !== 0) return difference;
  }
  if (left.steps.length !== right.steps.length) return left.steps.length - right.steps.length;
  return (left.offset ?? 0) - (right.offset ?? 0);
}

function startPath(cfi: ParsedCfi) {
  return cfi.kind === "point"
    ? cfi.path
    : { ...cfi.start, steps: [...cfi.base.steps, ...cfi.start.steps] };
}

function compareCfis(left: ParsedCfi, right: ParsedCfi): number {
  const packageDifference = comparePath(
    left.packagePath ?? { steps: [] },
    right.packagePath ?? { steps: [] },
  );
  return packageDifference === 0
    ? comparePath(startPath(left), startPath(right))
    : packageDifference;
}

export function isFurtherAlong(remoteCfi: string, localCfi: string): boolean {
  const remotePage = parsePageCfi(remoteCfi);
  const localPage = parsePageCfi(localCfi);

  if (remotePage !== null || localPage !== null) {
    return remotePage !== null && localPage !== null && remotePage > localPage;
  }

  try {
    return compareCfis(parseCfi(remoteCfi), parseCfi(localCfi)) > 0;
  } catch {
    return false;
  }
}
