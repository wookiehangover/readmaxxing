export interface StoredReadingPosition {
  readonly cfi: string;
  readonly localProgression?: number;
  readonly spineIndex?: number;
}

export interface PositionAcceptanceContext {
  readonly layoutHasSize: boolean;
  readonly layoutChangeInProgress: boolean;
  readonly navigationInProgress: boolean;
}

const LAYOUT_THRASH_PROGRESSION_REGRESSION = 0.1;

function isSectionStartCfi(cfi: string): boolean {
  return cfi.trim().endsWith("!/4)");
}

export function shouldAcceptReadingPosition(
  current: StoredReadingPosition | null,
  candidate: StoredReadingPosition,
  context: PositionAcceptanceContext,
): boolean {
  if (!current || context.navigationInProgress) return true;
  if (!context.layoutHasSize) return false;
  if (!context.layoutChangeInProgress) return true;
  if (candidate.cfi !== current.cfi && isSectionStartCfi(candidate.cfi)) return false;
  if (
    current.spineIndex !== undefined &&
    candidate.spineIndex !== undefined &&
    current.spineIndex !== candidate.spineIndex
  ) {
    return candidate.spineIndex > current.spineIndex;
  }
  if (
    current.localProgression !== undefined &&
    candidate.localProgression !== undefined &&
    Number.isFinite(current.localProgression) &&
    Number.isFinite(candidate.localProgression)
  ) {
    return (
      current.localProgression - candidate.localProgression < LAYOUT_THRASH_PROGRESSION_REGRESSION
    );
  }
  if (candidate.cfi === current.cfi) return true;
  return !isSectionStartCfi(candidate.cfi);
}

export function getReadingPositionRestoreTarget(
  current: StoredReadingPosition | null,
  candidate: StoredReadingPosition,
  context: PositionAcceptanceContext,
): StoredReadingPosition | null {
  if (!current || shouldAcceptReadingPosition(current, candidate, context)) return null;
  return current;
}

export interface ResolveStartCfiOpts {
  latestCfi: string | null;
  panelId: string | undefined;
  bookId: string;
  getPosition: (key: string) => Promise<string | null>;
}

export interface ResolveStartPositionOpts {
  latest: StoredReadingPosition | null;
  panelId: string | undefined;
  bookId: string;
  getPositionRecord: (key: string) => Promise<StoredReadingPosition | null>;
}

export async function resolveStartCfi(opts: ResolveStartCfiOpts): Promise<string | null> {
  const { latestCfi, panelId, bookId, getPosition } = opts;

  if (latestCfi) return latestCfi;

  if (panelId !== undefined) {
    const panelCfi = await getPosition(panelId);
    if (panelCfi) return panelCfi;
  }

  const bookCfi = await getPosition(bookId);
  if (bookCfi) return bookCfi;

  return null;
}

export async function resolveStartPosition(
  opts: ResolveStartPositionOpts,
): Promise<StoredReadingPosition | null> {
  const { latest, panelId, bookId, getPositionRecord } = opts;

  if (latest?.cfi) return latest;

  if (panelId !== undefined) {
    const panel = await getPositionRecord(panelId);
    if (panel?.cfi) return panel;
  }

  const book = await getPositionRecord(bookId);
  if (book?.cfi) return book;

  return null;
}

export interface SavePositionDualKeyOpts {
  panelId: string | undefined;
  bookId: string;
  cfi: string;
  localProgression?: number;
  spineIndex?: number;
  recordChange?: boolean;
  savePosition: (
    key: string,
    cfi: string,
    options?: {
      recordChange?: boolean;
      localProgression?: number;
      spineIndex?: number;
    },
  ) => Promise<void>;
}

export async function savePositionDualKey(opts: SavePositionDualKeyOpts): Promise<void> {
  const { panelId, bookId, cfi, localProgression, spineIndex, recordChange, savePosition } = opts;

  const layout = {
    ...(localProgression !== undefined ? { localProgression } : {}),
    ...(spineIndex !== undefined ? { spineIndex } : {}),
  };
  const hasLayout = localProgression !== undefined || spineIndex !== undefined;
  const bookOptions =
    recordChange === undefined ? (hasLayout ? layout : undefined) : { recordChange, ...layout };
  const bookSave =
    bookOptions === undefined ? savePosition(bookId, cfi) : savePosition(bookId, cfi, bookOptions);
  const saves: Promise<void>[] = [bookSave];
  if (panelId !== undefined) {
    saves.push(
      savePosition(
        panelId,
        cfi,
        hasLayout ? { recordChange: false, ...layout } : { recordChange: false },
      ),
    );
  }
  await Promise.all(saves);
}
