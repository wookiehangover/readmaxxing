import type {
  DisplayTarget,
  NavigatorNavigationPolicy,
  Relocation,
} from "@readmaxxing/epub-successor";
import type { AppStore } from "~/lib/themis/store";
import {
  backtrackReview,
  showReview,
  startReviewCheckpoint,
} from "~/lib/themis/reviews/reviews-slice";
import { spineIndexFromCfi, type SuccessorRenditionAdapter } from "./successor-reader-adapter";
import {
  ReviewNavigationSource,
  unitContentRange,
  unitLastSpine,
  type ReviewNavigationUnit,
} from "./review-navigation-source";

interface ReviewReturnLocator {
  version: 1;
  key: string;
  fingerprint: string;
  cfi: string;
  localProgression: number;
  layout: string;
}

export interface ReviewNavigationControls {
  backToChapter(): Promise<void>;
  continueReading(): Promise<void>;
  showQuestion(): void;
}

/** DOM/engine lifetime bridge. Every eligibility read comes from the existing reviews owner. */
export class ReviewNavigation implements NavigatorNavigationPolicy, ReviewNavigationControls {
  rendition: SuccessorRenditionAdapter | null = null;
  #restoring: Promise<void> | null = null;
  #destroyed = false;

  constructor(
    readonly store: AppStore,
    readonly bookId: string,
    readonly readerId: string,
    readonly source: ReviewNavigationSource,
    readonly layout: () => string,
  ) {}

  private get selectors() {
    return this.store.reviewsSelectors;
  }
  private get enabled() {
    return this.selectors.selectReviewPreferences.select(this.store.state, this.bookId).enabled;
  }
  private get checkpoint() {
    return this.selectors.selectReviewCheckpoint.select(this.store.state, this.bookId);
  }
  private get locked() {
    return this.selectors.selectReviewLocked.select(this.store.state, this.bookId);
  }
  private get visible() {
    return this.selectors.selectReviewVisible.select(this.store.state, this.bookId);
  }
  private get confirming() {
    return !!this.selectors.selectReviewRequest.select(this.store.state, this.bookId, "progress")
      ?.token;
  }
  private get heldChapter() {
    return this.locked || (this.enabled && this.confirming) ? this.checkpoint?.key : undefined;
  }
  private get ready() {
    const state = this.store.state.reviews;
    return (
      !this.#destroyed &&
      state.readerId === this.readerId &&
      state.bookId === this.bookId &&
      (!state.userId || state.localStatus === "ready")
    );
  }
  private get currentUnit() {
    const navigator = this.rendition?.navigator;
    const key = navigator?.currentContentRange?.key;
    return key ? this.source.units.find((unit) => unit.boundary.key === key) : undefined;
  }
  private passed(unit: ReviewNavigationUnit) {
    return this.selectors.selectReviewChapterPassed.select(
      this.store.state,
      this.bookId,
      unit.boundary.key,
      unit.fingerprint,
    );
  }

  resolve(target: DisplayTarget): DisplayTarget | false {
    if (!this.ready) return false;
    if (!this.enabled) return { ...target, contentRange: undefined };
    const unit = this.source.unitForTarget(target);
    if (this.heldChapter && (!unit || unit.boundary.key !== this.heldChapter)) return false;
    if (!unit) {
      if (this.source.containsReviewContent(this.source.spineIndex(target)))
        throw new RangeError("Navigation target could not be resolved to a review chapter");
      return { ...target, contentRange: undefined };
    }
    // A full-spine percentage is not a percentage of a clipped chapter. Only
    // validated return locators below carry progression in the current range.
    return {
      ...target,
      localProgression:
        target.contentRange?.key === unit.boundary.key ? target.localProgression : undefined,
      contentRange: unitContentRange(unit, this.source.spineIndex(target)),
    };
  }

  allowCommit(target: DisplayTarget): boolean {
    if (!this.ready) return false;
    if (!this.enabled) return true;
    const unit = this.source.unitForTarget(target);
    if (!unit && this.source.containsReviewContent(this.source.spineIndex(target))) return false;
    if (unit && target.contentRange?.key !== unit.boundary.key) return false;
    return !this.heldChapter || (!!unit && unit.boundary.key === this.heldChapter);
  }

  allowMovement(direction: "next" | "previous" | "restore" | "speedread"): boolean {
    if (!this.ready || this.#restoring) return false;
    if (!this.enabled) return true;
    if (!this.rendition?.navigator.currentContentRange) {
      const current = this.rendition?.navigator.currentRelocation;
      // Ineligible/missing TOC units retain normal navigation; an eligible
      // spine must first acquire its bounded layout when reviews are enabled.
      return (
        !this.heldChapter && (!current || !this.source.containsReviewContent(current.spineIndex))
      );
    }
    // Its snapshot is bounded to this chapter; outstanding reviews close the
    // popout and reject entry through this same admission policy.
    if (direction === "speedread") return !this.locked && !this.visible;
    if (this.visible) {
      if (direction === "previous") void this.backToChapter().catch(console.warn);
      else if (direction === "next" && !this.locked && !this.confirming)
        void this.continueReading().catch(console.warn);
      return false;
    }
    return true;
  }

  boundary(direction: "next" | "previous", current: Relocation): DisplayTarget | false | undefined {
    if (!this.ready) return false;
    const unit = this.currentUnit;
    if (!unit) return undefined;
    if (
      direction === "next" &&
      current.spineIndex < unitLastSpine(unit, this.source.documents.length)
    )
      return this.source.target(unit, "start", current.spineIndex + 1);
    if (direction === "previous" && current.spineIndex > unit.boundary.start.spineIndex)
      return this.source.target(unit, "end", current.spineIndex - 1);
    if (this.enabled && this.confirming) return false;
    if (this.enabled && direction === "next" && !this.passed(unit)) {
      const location = this.rendition?.location?.start;
      const locator: ReviewReturnLocator | null = location
        ? {
            version: 1,
            key: unit.boundary.key,
            fingerprint: unit.fingerprint,
            cfi: location.cfi,
            localProgression: current.localProgression,
            layout: this.layout(),
          }
        : null;
      this.store.dispatch(
        startReviewCheckpoint(
          this.bookId,
          unit.chapterIndex,
          unit.boundary,
          locator ? JSON.stringify(locator) : null,
        ),
      );
      return false;
    }
    if (this.locked) return false;
    const index = this.source.units.indexOf(unit) + (direction === "next" ? 1 : -1);
    const adjacent = this.source.units[index];
    return adjacent
      ? this.source.target(adjacent, direction === "next" ? "start" : "end")
      : undefined;
  }

  initialTarget(target: DisplayTarget): DisplayTarget {
    if (!this.heldChapter) return target;
    const unit = this.source.unitForTarget(target);
    return unit?.boundary.key === this.checkpoint?.key ? target : this.returnTarget();
  }

  fallbackTarget(target: DisplayTarget): DisplayTarget {
    if (this.heldChapter) {
      const unit = this.source.units.find((unit) => unit.boundary.key === this.checkpoint?.key);
      if (!unit) throw new RangeError("The reviewed chapter is unavailable in this EPUB.");
      return this.source.target(unit);
    }
    return { spineIndex: Math.max(0, this.source.spineIndex(target)) };
  }

  private returnTarget(): DisplayTarget {
    const checkpoint = this.checkpoint;
    const unit = this.source.units.find((unit) => unit.boundary.key === checkpoint?.key);
    if (!unit)
      throw new RangeError(
        "The reviewed chapter is unavailable in this EPUB. Disable reviews to continue.",
      );
    try {
      const saved = JSON.parse(checkpoint?.returnLocator ?? "null") as ReviewReturnLocator | null;
      if (
        saved?.version === 1 &&
        saved.key === unit.boundary.key &&
        saved.fingerprint === unit.fingerprint &&
        typeof saved.cfi === "string"
      ) {
        const spineIndex = spineIndexFromCfi(saved.cfi);
        if (spineIndex === null) return this.source.target(unit);
        const target: DisplayTarget = { spineIndex, cfi: saved.cfi };
        if (this.source.unitForTarget(target) === unit)
          return {
            ...target,
            contentRange: unitContentRange(unit, spineIndex),
            ...(saved.layout === this.layout() && Number.isFinite(saved.localProgression)
              ? { localProgression: saved.localProgression }
              : {}),
          };
      }
    } catch {
      /* Old, replaced or invalid locators fall back to the current boundary. */
    }
    return this.source.target(unit);
  }

  backToChapter(): Promise<void> {
    if (this.#restoring) return this.#restoring;
    if (!this.ready || !this.rendition || !this.checkpoint) return Promise.resolve();
    const generation = this.store.state.reviews.generation;
    const key = this.checkpoint.key;
    this.#restoring = (async () => {
      const target = this.returnTarget();
      const navigator = this.rendition!.navigator;
      try {
        await navigator.display(target);
      } catch (error) {
        if (!(error instanceof RangeError) || !this.ready) throw error;
        const unit = this.source.units.find((unit) => unit.boundary.key === key);
        if (!unit) throw error;
        await navigator.display(this.source.target(unit));
      }
      if (
        this.ready &&
        generation === this.store.state.reviews.generation &&
        key === this.checkpoint?.key
      )
        this.store.dispatch(backtrackReview(this.bookId));
    })().finally(() => {
      this.#restoring = null;
    });
    return this.#restoring;
  }

  async continueReading(): Promise<void> {
    if (!this.ready || this.locked || this.confirming || !this.rendition) return;
    const generation = this.store.state.reviews.generation;
    const current = this.currentUnit;
    const next = current && this.source.units[this.source.units.indexOf(current) + 1];
    if (next) await this.rendition.navigator.display(this.source.target(next));
    if (this.ready && generation === this.store.state.reviews.generation && !this.locked)
      this.store.dispatch(backtrackReview(this.bookId));
  }

  showQuestion(): void {
    if (this.ready) this.store.dispatch(showReview(this.bookId));
  }
  destroy(): void {
    this.#destroyed = true;
    this.rendition = null;
  }
}
