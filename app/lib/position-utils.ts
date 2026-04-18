/**
 * Pure helper functions for dual-key reading position save/restore logic.
 *
 * Extracted from workspace-book-reader.tsx so the priority resolution
 * and dual-key save can be unit-tested without IndexedDB or React.
 */

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

export interface SavePositionDualKeyOpts {
  /** Panel-specific key (may be undefined when there is no dockview panel). */
  panelId: string | undefined;
  /** Book-level key. */
  bookId: string;
  /** The CFI string to persist. */
  cfi: string;
  /**
   * Callback to persist a position by key. The optional `options` bag is
   * forwarded to the underlying service — when `recordChange: false` the
   * write is local-only (no sync changelog entry).
   */
  savePosition: (key: string, cfi: string, options?: { recordChange?: boolean }) => Promise<void>;
}

/**
 * Save a reading position under both the panel key and the book key.
 *
 * When `panelId` is undefined only the book-level key is written.
 *
 * Only the book-level save emits a sync changelog entry. The panel-key save
 * is a device-local mirror (panel ids are random per-session UUIDs that no
 * other device queries) so recording a second change for it just doubles
 * every page-turn push without adding useful state for other devices.
 */
export async function savePositionDualKey(opts: SavePositionDualKeyOpts): Promise<void> {
  const { panelId, bookId, cfi, savePosition } = opts;

  const saves: Promise<void>[] = [savePosition(bookId, cfi)];
  if (panelId !== undefined) {
    saves.push(savePosition(panelId, cfi, { recordChange: false }));
  }
  await Promise.all(saves);
}
