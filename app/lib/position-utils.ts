/**
 * Pure helper functions for dual-key reading position save/restore logic.
 *
 * Extracted from workspace-book-reader.tsx so the priority resolution
 * and dual-key save can be unit-tested without IndexedDB or React.
 */

export interface StoredReadingPosition {
  readonly cfi: string;
  readonly localProgression?: number;
  readonly spineIndex?: number;
}

export interface PositionAcceptanceContext {
  readonly layoutChangeInProgress: boolean;
  readonly navigationInProgress: boolean;
}

const LAYOUT_THRASH_PROGRESSION_REGRESSION = 0.1;

function isSectionStartCfi(cfi: string): boolean {
  return cfi.trim().endsWith("!/4)");
}

/**
 * Reject section-start and large backward relocations while layout is settling.
 * Explicit navigation and small scroll deltas remain accepted.
 */
export function shouldAcceptReadingPosition(
  current: StoredReadingPosition | null,
  candidate: StoredReadingPosition,
  context: PositionAcceptanceContext,
): boolean {
  if (!current || context.navigationInProgress || !context.layoutChangeInProgress) return true;
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

export interface ResolveStartCfiOpts {
  /** In-memory CFI from the current session (highest priority). */
  latestCfi: string | null;
  /** Panel-specific key (unique per dockview panel). */
  panelId: string | undefined;
  /** Book-level key (shared across panels showing the same book). */
  bookId: string;
  /** Callback to look up a persisted position by key. */
  getPosition: (key: string) => Promise<string | null>;
}

export interface ResolveStartPositionOpts {
  /** In-memory position from the current session (highest priority). */
  latest: StoredReadingPosition | null;
  panelId: string | undefined;
  bookId: string;
  getPositionRecord: (key: string) => Promise<StoredReadingPosition | null>;
}

/**
 * Resolve the CFI to display when opening / re-mounting a book.
 *
 * Priority:
 *  1. `latestCfi` — kept in a ref across layout changes within the same session.
 *  2. Panel-specific position — survives browser refresh when the workspace
 *     layout is restored with the same panel IDs.
 *  3. Book-level position — the "last read" fallback shared by all panels.
 *  4. `null` — no saved position; the renderer will open at the beginning.
 */
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

/**
 * Like resolveStartCfi, but also returns localProgression/spineIndex when stored
 * so paginated restore can jump to the exact column.
 */
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
  /** Panel-specific key (may be undefined when there is no dockview panel). */
  panelId: string | undefined;
  /** Book-level key. */
  bookId: string;
  /** The CFI string to persist. */
  cfi: string;
  /** Section-local progression [0,1] for exact paginated restore. */
  localProgression?: number;
  /** Spine index paired with localProgression. */
  spineIndex?: number;
  /** Whether the book-level save should emit a sync changelog entry. Defaults to true. */
  recordChange?: boolean;
  /**
   * Callback to persist a position by key. The optional `options` bag is
   * forwarded to the underlying service — when `recordChange: false` the
   * write is local-only (no sync changelog entry).
   */
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

/**
 * Save a reading position under both the panel key and the book key.
 *
 * When `panelId` is undefined only the book-level key is written.
 *
 * By default only the book-level save emits a sync changelog entry. Pass
 * `recordChange: false` to make both writes local-only. The panel-key save is
 * always a device-local mirror (panel ids are random per-session UUIDs that no
 * other device queries) so recording a second change for it just doubles every
 * page-turn push without adding useful state for other devices.
 */
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
