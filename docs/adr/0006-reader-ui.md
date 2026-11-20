# ADR 0006: Reader and library UI decisions

- Status: Accepted
- Date: 2026-11-20
- Source: code comments removed in the comment cleanup

## Suppress hover re-open briefly after explicit popover dismiss

**Context.** Base UI popovers with hover triggers immediately re-open on trigger-hover after an outside click or Escape, because the pointer is still over the trigger.

**Decision.** After an outside-press or escape-key dismiss, ignore trigger-hover open requests for 400ms (suppressHoverUntil ref).

**Consequences.** Popover stays closed after a deliberate dismiss; hover re-open works again after the window.

**Code.** `app/components/book-list.tsx#handleOpenChange`

## Book spines omit subtitles

**Context.** Printed spines show short titles; long subtitles overflow narrow spines.

**Decision.** The spine shows only the text before the first ": "; the button accessible label keeps the full title.

**Consequences.** Spines stay short and readable without losing the full title for assistive tech.

**Code.** `app/components/bookshelf/bookshelf-book.tsx#BookshelfBook`

## Remount bookshelf 3D scene when active state changes

**Context.** WebKit flattens 3D faces that are added to a preserve-3d perspective root after it was first rendered.

**Decision.** The .bookshelf-scene span is keyed on active/inactive so the perspective root is rebuilt together with its faces when a book becomes active.

**Consequences.** Faces render correctly in Safari; the scene subtree remounts on each activation.

**Code.** `app/components/bookshelf/bookshelf-book.tsx#BookshelfBook`

## Paired cloth/ink spine palette

**Context.** Generated book spines (including books without covers) need readable title text on any background color.

**Decision.** CLOTH_COLORS is a fixed list of [cloth, ink] pairs chosen for contrast instead of computing text color separately.

**Consequences.** Every generated spine is legible; adding colors requires choosing a matching ink color.

**Code.** `app/components/bookshelf/bookshelf-book.tsx#CLOTH_COLORS`

## Close bookshelf selection when the viewport changes

**Context.** The selected-book placement is measured in viewport coordinates and becomes wrong after resize or shelf scroll.

**Decision.** Selection closes on window resize and on desktop shelf scroll rather than re-measuring.

**Consequences.** Placement never drifts; users must reselect after scrolling or resizing.

**Code.** `app/components/bookshelf/bookshelf-stack.tsx#BookshelfStack`

## Refocus bookshelf trigger with focus() after pointer dismissal

**Context.** Safari shows a keyboard focus ring when focus is restored the wrong way after a pointer-driven dismissal.

**Decision.** On dismissal the trigger is focused programmatically with preventScroll so no keyboard focus ring is manufactured in Safari.

**Consequences.** Focus returns to the trigger without a spurious ring or scroll jump.

**Code.** `app/components/bookshelf/bookshelf-stack.tsx#BookshelfStack`

## Only close bookshelf selection on real scroll offset changes

**Context.** Scrolling a book into view before selection can deliver its scroll event after the scroll listener mounts, which would immediately close the new selection.

**Decision.** onScroll closes only if the shelf scrollTop/scrollLeft differ from values captured at mount.

**Consequences.** Late scroll events from selection itself are ignored.

**Code.** `app/components/bookshelf/bookshelf-stack.tsx#onScroll`

## Only nearby bookshelf rows recede in 3D

**Context.** Promoting every shelf row to its own 3D layer stalls WebKit on large libraries.

**Decision.** On desktop only rows within a 200px gutter of the visible shelf get the receding transform; mobile gets none. Desktop scroll dismisses selection so off-screen rows never need it.

**Consequences.** Large libraries stay responsive in Safari; rows outside the gutter do not animate.

**Code.** `app/components/bookshelf/bookshelf-stack.tsx#recedingIds`

## Quantize cover pixels before picking a dominant color

**Context.** Cover texture creates many slightly different colors that would split the dominant color.

**Decision.** dominantCoverColors buckets pixels by the top 2 bits of each channel (64 groups), ignoring mostly transparent pixels, and averages the largest group.

**Consequences.** A stable dominant spine color; fine color distinctions are lost.

**Code.** `app/components/bookshelf/cover-color.ts#dominantCoverColors`

## Fall back to default spine colors for unreadable covers

**Context.** getImageData throws for cross-origin (tainted) or unreadable images.

**Decision.** readCoverColors catches and returns null, so the spine keeps its generated fallback colors.

**Consequences.** Cross-origin covers never break rendering; they just use fallback colors.

**Code.** `app/components/bookshelf/cover-color.ts#readCoverColors`

## Sample cover colors from the displayed image element

**Context.** Fetching cover images again just for color extraction would cost extra network and decode work.

**Decision.** readCoverColors draws the already-decoded HTMLImageElement into a 48x48 canvas and reads pixels from it.

**Consequences.** No extra download; depends on the image being same-origin (see fallback on tainted canvas).

**Code.** `app/components/bookshelf/cover-color.ts#readCoverColors`

## Drop zone reacts only to OS file drags

**Context.** Internal DOM drag-and-drop (e.g. reordering) would otherwise activate the library drop overlay.

**Decision.** handleDragEnter and handleDrop only act when dataTransfer.types includes "Files".

**Consequences.** Internal drags pass through untouched.

**Code.** `app/components/drop-zone.tsx#handleDragEnter`

## Dismiss highlight menu on window blur

**Context.** Clicking inside a reader iframe does not fire pointerdown on the parent document; it blurs the parent window instead.

**Decision.** The highlight context menu dismisses on window blur in addition to outside pointerdown, resize and Escape.

**Consequences.** Menu closes when the user clicks into the book content.

**Code.** `app/components/highlight-context-menu.tsx#HighlightContextMenu`

## Delay highlight popover outside-click listener

**Context.** The mousedown that created the text selection would otherwise immediately count as an outside click and dismiss the popover.

**Decision.** The mousedown listener is attached after a 100ms timeout.

**Consequences.** Clicks in the first 100ms after opening do not dismiss.

**Code.** `app/components/highlight-popover.tsx#HighlightPopover`

## RadialProgress value is a percentage

**Context.** Progress values elsewhere may be fractions.

**Decision.** RadialProgress.value expects 0-100.

**Consequences.** Callers must convert fractions to percent.

**Code.** `app/components/radial-progress.tsx#RadialProgressProps`

## Reading rail context carries only render scope

**Context.** Reading rail state could live in context or the Themis store.

**Decision.** ReadingRailContext holds only scope, owner, mobile and privateBookId; active tab selection and tab eligibility live in Redux selectors.

**Consequences.** Context stays stable; state changes go through the store.

**Code.** `app/components/reading-shell/reading-rail-context.tsx#ReadingRailContext`

## Reading rail scope hook returns plain values

**Context.** Base UI Tabs/Menu components take plain value props, not signals.

**Decision.** The scope hook reads selectActiveReadingRailTab with useValue so consumers get a plain value.

**Consequences.** Base UI components can consume it directly.

**Code.** `app/components/reading-shell/reading-rail-context.tsx#ReadingRailContext`

## Rail width persistence tolerates unavailable storage

**Context.** sessionStorage throws in privacy-restricted browser contexts.

**Decision.** persistRailWidth and the initial read swallow storage errors; the default width is used when reading fails.

**Consequences.** Rail width just does not persist in those contexts.

**Code.** `app/components/reading-shell/reading-split.tsx#persistRailWidth`

## Speed-read popout layout persistence is optional

**Context.** localStorage can throw when storage is unavailable.

**Decision.** saveLayout swallows storage errors.

**Consequences.** Layout just does not persist in those contexts.

**Code.** `app/components/speedread-popout.tsx#saveLayout`

## ScrollArea hideScrollbar only hides custom scrollbars

**Context.** Some surfaces need scrolling without visible scrollbars.

**Decision.** hideScrollbar omits the Base UI scrollbar elements; the viewport still scrolls by wheel, trackpad and touch.

**Consequences.** Not a way to disable scrolling.

**Code.** `app/components/ui/scroll-area.tsx#ScrollArea`

## Close speed-read popout when reviews preference changes

**Context.** An open speed-read popout may hold a full-spine snapshot; enabling reviews bounds the navigator to the current chapter.

**Decision.** An effect closes the popout whenever reviewsEnabled changes so reopening reads the newly bounded chapter.

**Consequences.** The popout closes on that preference change.

**Code.** `app/components/workspace-book-reader.tsx#WorkspaceBookReaderInner`

## Portal reader popovers to document.body

**Context.** Popovers use position:fixed with viewport coordinates; inside transformed dockview panels fixed positioning becomes relative to the panel.

**Decision.** HighlightPopover and related popovers render through createPortal into document.body.

**Consequences.** Coordinates are viewport-relative.

**Code.** `app/components/workspace-book-reader.tsx#WorkspaceBookReaderInner`

## PDF reader passes handleOpenNotebook to usePdfHighlights through a ref

**Context.** usePdfHighlights is called before handleOpenNotebook is defined, and the handler changes over time.

**Decision.** Pass a ref holding a () => void and update it later, so usePdfHighlights always calls the latest handleOpenNotebook.

**Consequences.** No stale closure and no hook ordering cycle; readers must remember the ref is filled in after the hook runs.

**Code.** `app/components/workspace-pdf-reader.tsx#handleOpenNotebookRef`

## PDF highlight popovers render through a portal to document.body

**Context.** The popovers use position:fixed, and an ancestor with a transform or containment would make fixed positioning relative to that ancestor instead of the viewport.

**Decision.** Portal the selection and highlight popovers to document.body.

**Consequences.** Popover coordinates can be viewport-based; the popovers live outside the reader DOM tree.

**Code.** `app/components/workspace-pdf-reader.tsx#WorkspacePdfReaderInner`

## Library sort preference survives localStorage write failures

**Context.** localStorage can throw (private mode, quota, disabled storage).

**Decision.** Swallow write errors when saving the library sort key and keep the choice in memory for the session.

**Consequences.** Sorting still works; the choice is just not persisted.

**Code.** `app/components/workspace/library-browse-content.tsx#saveLibrarySortBy`

## Blob object URLs are keyed by a stable id and revoked late

**Context.** IndexedDB returns a new Blob instance on every read and sync re-fetches the whole book list, so blob identity changes constantly; Safari also breaks if a URL is revoked before the new <img src> decodes.

**Decision.** useBlobObjectUrl keeps the existing URL while key is unchanged even if the blob reference changes; when key changes it creates a new URL and revokes the previous one after a short delay; it revokes any live URL on unmount.

**Consequences.** Covers do not flicker on sync; callers must pass a key that changes when the content changes.

**Code.** `app/hooks/use-blob-object-url.ts#useBlobObjectUrl`

## Book tilt uses the cover bounds captured at hover start

**Context.** The cover moves as it tilts; measuring it again each move would feed the tilt back into itself.

**Decision.** Cache the .bookshelf-cover rect on first move and reuse it.

**Consequences.** Stable tilt with no feedback jitter.

**Code.** `app/hooks/use-book-tilt.ts#useBookTilt`

## Bookshelf camera leads the scroll and springs back

**Context.** The shelf should feel like a camera on a dolly.

**Decision.** Add a lead offset (LEAD_MS, LEAD_STIFFNESS, LEAD_DAMPING) that runs ahead of the scroll and springs back to rest.

**Consequences.** Scrolling feels physical; the constants are tuned by eye.

**Code.** `app/hooks/use-bookshelf-camera.ts#LEAD_MS`

## Bookshelf covers keep a gap at rest and close up in motion

**Context.** Covers should not overlap the book above at rest, but a moving stack should look like a pile.

**Decision.** Use REST_GAP (22px) at rest and MOTION_GAP (4px) while moving.

**Consequences.** The stack compresses during scrolling and spreads out again.

**Code.** `app/hooks/use-bookshelf-camera.ts#REST_GAP`

## Bookshelf camera integrates its spring in fixed 4 ms steps

**Context.** A frame-sized step makes the spring behave differently on 60 Hz and 120 Hz screens.

**Decision.** Advance the spring in STEP_MS slices across the elapsed time.

**Consequences.** Same motion on every refresh rate at a small CPU cost.

**Code.** `app/hooks/use-bookshelf-camera.ts#useBookshelfCamera`

## Bookshelf visibility observes stable rows, not cover faces

**Context.** Cover faces are transformed during selection, which would change their intersection and toggle visibility.

**Decision.** Observe the stack children (rows) with the IntersectionObserver.

**Consequences.** Selecting a book does not unload nearby covers.

**Code.** `app/hooks/use-bookshelf-visibility.ts#useBookshelfVisibility`

## Highlight context menu positions are in viewport coordinates

**Context.** Events come from inside the EPUB iframe, where coordinates are iframe-relative.

**Decision.** onHighlightContextMenu receives viewport coordinates.

**Consequences.** Callers can position fixed menus directly.

**Code.** `app/hooks/use-highlights.ts#UseHighlightsOptions.onHighlightContextMenu`

## Speed-read WPM and progress persistence is best-effort

**Context.** localStorage can be unavailable or throw.

**Decision.** Swallow localStorage write errors for speed-read WPM and per-book progress.

**Consequences.** Speed reading still works; settings are just not remembered.

**Code.** `app/hooks/use-speedread-playback.ts#saveWpm`

## Color themes follow the published upstream palettes

**Context.** Named themes should look like their originals.

**Decision.** Dracula follows https://draculatheme.com/contribute#color-palette, Nord https://www.nordtheme.com/docs/colors-and-palettes, Rosé Pine https://rosepinetheme.com/palette, Tokyo Night https://github.com/enkia/tokyo-night-vscode-theme, and Solarized https://ethanschoonover.com/solarized/. Values are converted to oklch to match app.css.

**Consequences.** Palette edits should be checked against these sources.

**Code.** `app/lib/color-themes.ts#COLOR_THEMES`

## Reader navigation setter wraps the function before storing it in state

**Context.** useState treats a function passed to its setter as an updater and would call it.

**Decision.** stableSetNavigateToHref calls setNavigateToHref(() => fn) inside a useCallback with empty deps (the setter is already stable).

**Consequences.** Consumers can register navigation functions safely.

**Code.** `app/lib/context/reader-context.tsx#stableSetNavigateToHref`

## Review navigation clips reading to the active chapter via a navigation policy

**Context.** When chapter reviews are enabled, the reader must not advance past an unreviewed chapter, and positions must map correctly inside a clipped chapter range.

**Decision.** ReviewNavigation is a DOM/engine lifetime bridge; every eligibility read comes from the existing reviews owner. Navigation sources fingerprint full extracted text but compare DOM anchors, never normalized offsets. Section documents are assembled exactly like the mounted tree (sanitization and inserted missing head) because even structural repair changes the body's CFI element index. A bare spine target means its first readable interval (not DOM offset 0, since trimmed offsets can skip whitespace before a heading) and keeps the interval's fragment bounds. Full-spine percentages are dropped; only validated return locators for the current range carry progression. Ineligible/missing TOC units keep normal navigation; eligible spines must first acquire bounded layout. Speed-read snapshots are bounded to the chapter and are rejected while reviews are outstanding or visible. Old, replaced or invalid locators fall back to the current boundary.

**Consequences.** Navigation behavior depends on review eligibility; locator formats are range-scoped.

**Code.** `app/lib/epub/review-navigation.ts#ReviewNavigation`

## Character-sampled reading positions and visible-range sampling

**Context.** Without a publisher page-list the reader needs stable page analogues, and saving the reading position needs a range that reflects the visible page.

**Decision.** Positions are character samples every HEURISTIC_CHARS_PER_PAGE (2500) chars; POSITION_CACHE_VERSION is bumped whenever sampling semantics change (empty-section skip, chars/page). pageIndexFromPositions takes totals from samples (stable across layout) and advances the current page with localProgression inside the active section, staying on the first sample at section start; single-sample sections may advance toward the next sample; when href matching fails due to path normalization drift it falls back to the spine index. visibleRange samples several content-area points past typical body chrome (not 1,1) and rejects carets outside the viewport (some engines snap to document-start text), falling back to the first visible element, never the section's first text, which would pin every save to chapter start. rangesAtTextSpans resolves ascending spans in one walk and returns static boundary objects because generateCfi only reads boundaries and Range.setEnd collapses on DOMParser documents in happy-dom. Case-insensitive search folds with toLocaleLowerCase only when lengths are preserved (e.g. 'I with dot' folds to two code units), else matches exactly; result CFIs are full spans so they can render as highlight decorations. Spine display does one admission and one relocation so a transient spine start is never exposed or persisted.

**Consequences.** Changing sampling requires a cache version bump; page numbers are approximate.

**Code.** `app/lib/epub/successor-reader-adapter.ts#pageIndexFromPositions`

## Start position resolution priority

**Context.** A book can be reopened or remounted with an in-memory position, a reader-instance (panel) position, or a book-level position.

**Decision.** resolveStartCfi/resolveStartPosition use, in order: 1) latestCfi kept in a ref across layout changes in the session, 2) reader-instance (panel) position for legacy instance-specific restores, 3) book-level 'last read' position shared by all panels, 4) null so the renderer opens at the beginning.

**Consequences.** Layout changes never lose position; the panel key is a legacy fallback and the book key is the cross-panel source of truth.

**Code.** `app/lib/position-utils.ts#resolveStartCfi`

## Reject layout-driven reading position relocations

**Context.** While the reader lays out (hidden, resizing, settling), the renderer emits relocations that would overwrite the user's real position.

**Decision.** shouldAcceptReadingPosition rejects relocations while layout is hidden, and rejects section-start and large backward relocations while layout is settling; explicit navigation is always accepted. getReadingPositionRestoreTarget returns the last-good position so a bad relocation can be undone.

**Consequences.** Saved position survives resizes and reflows; legitimate large backward jumps during settling must be flagged explicit.

**Code.** `app/lib/position-utils.ts#shouldAcceptReadingPosition`

## Review lock holds while newer chapter source is unresolved

**Context.** Review responses can arrive out of order relative to a newer source-authority snapshot.

**Decision.** Never mark the review passed or release navigation while a newer source authority is unresolved; stale responses are ignored and the older request is aborted.

**Consequences.** Out-of-order responses cannot unlock chapters incorrectly.

**Code.** `app/lib/review/__tests__/review-ordering.integration.test.ts`

## Review resubmission waits for chapter source confirmation

**Context.** A grading verdict can arrive before the server confirms the current chapter source.

**Decision.** selectReviewCanSubmit stays false until the progress confirmation restores source authority.

**Consequences.** Users cannot resubmit against an unconfirmed chapter source.

**Code.** `app/lib/review/__tests__/review-workflow.integration.test.ts`

## Clamp focusedSplitRatio on read and write

**Context.** focusedSplitRatio is the fraction of the focused-mode workspace given to the book-reader group (chat/notebook gets 1 - ratio), one global value across clusters. A corrupt or degenerate value in localStorage could permanently collapse or strand a panel.

**Decision.** Bound it to [0.2, 0.8] via clampFocusedSplitRatio, falling back to 0.5 for non-finite values, and apply the clamp both in readLocalUI and in saveSettings.

**Consequences.** No stored value can strand a panel; callers can pass raw computed ratios.

**Code.** `app/lib/settings.ts#clampFocusedSplitRatio`

## Migrate legacy pixel font sizes to percentages on read

**Context.** Font size was stored in pixels under the old schema and as a percentage now.

**Decision.** LegacyFontSize preprocesses stored values: values <= 40 are treated as pixels and converted with round(val / 0.16); larger values are percentages; non-numbers default to 100.

**Consequences.** Old settings keep working; a percentage of 40 or less cannot be represented.

**Code.** `app/lib/settings.ts#LegacyFontSize`

## Persist section-local progression and spine index with reading positions

**Context.** Restoring a paginated EPUB position from CFI geometry alone often lands one page early or late after refresh.

**Decision.** PositionRecord stores localProgression (section-local progression in [0,1] from the navigator at save time) and spineIndex alongside the CFI; restore uses the pair to land on the exact paginated column.

**Consequences.** Position records carry optional layout metadata; savePosition clamps localProgression to [0,1] and only accepts non-negative integer spine indexes.

**Code.** `app/lib/stores/position-store.ts#PositionRecord`

## Reading rail tab memory is best-effort and excludes Details

**Context.** The reading rail remembers the selected tab per scope in sessionStorage; storage can be unavailable (privacy modes, quota).

**Decision.** restore and persist swallow storage errors and keep the in-memory selection. The Details tab is transient and is never persisted or restored, so reloads return to the last reading section.

**Consequences.** Tab memory silently disappears when storage fails; Details never survives a reload.

**Code.** `app/lib/themis/reading-rail/sagas/reading-rail-saga.ts#persist`

## Inline pre-hydration theme script

**Context.** Theme class and color theme variables applied by React after hydration cause a flash of unstyled/incorrect theme.

**Decision.** root.tsx embeds an inline script that reads app-settings from localStorage and sets the dark class, color theme CSS variables and theme-color meta before React hydrates. It must be self-contained (no imports); non-default theme variables are serialized into it at build/SSR time.

**Consequences.** Theme changes require keeping the script and COLOR_THEMES in sync; the script cannot use app modules.

**Code.** `app/root.tsx#themeScript`

## Chapter label is published after the initial EPUB relocation settles

**Context.** The toolbar chapter button is labelled from relocation events.

**Decision.** Tests must wait for the "current chapter" label before reading page state since it only appears after the first relocation settles.

**Consequences.** Reading page state too early yields stale values.

**Code.** `e2e/workspace.spec.ts`

## Right-clicking a highlight replaces the selection menu

**Context.** A user may have another passage selected when right-clicking an existing highlight.

**Decision.** The highlight context menu takes precedence and replaces the selection menu.

**Consequences.** Selection menu is dismissed when the highlight menu opens.

**Code.** `e2e/workspace.spec.ts`

## Search matches render via CSS Custom Highlight API or overlay spans

**Context.** Browsers differ in support for the CSS Custom Highlight API.

**Decision.** Search result decorations are drawn with CSS highlights when available, falling back to overlay spans; the E2E counts either.

**Consequences.** Tests must check both rendering paths.

**Code.** `e2e/workspace.spec.ts`
