import { afterEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import {
  generateCfi,
  normalizePublicationPath,
  type DisplayTarget,
  type Publication,
} from "@readmaxxing/epub-successor";
import { createAppStore, type AppStore } from "~/lib/themis/store";
import { authSessionResolved } from "~/lib/themis/auth-session/auth-session-slice";
import { createReviewsSaga } from "~/lib/themis/reviews/sagas/reviews-saga";
import {
  backtrackReview,
  closeReviewBook,
  openReviewBook,
  reviewLocalSourcesObserved,
  reviewRequestStarted,
  reviewProgressReceived,
  reviewCacheLoaded,
  setReviewsEnabled,
} from "~/lib/themis/reviews/reviews-slice";
import {
  fingerprint,
  questionResponse,
  submitResponse,
  document as answerDocument,
} from "~/lib/themis/reviews/reviews-test-fixtures";
import { ReviewNavigation } from "../review-navigation";
import { ReviewNavigationSource, type ReviewNavigationUnit } from "../review-navigation-source";
import { collectReviewAnchorOffsets } from "../review-chapter-boundaries";
import type { SuccessorRenditionAdapter } from "../successor-reader-adapter";

vi.mock("~/lib/review/review-cache", () => ({
  loadReviewCache: async () => null,
  saveReviewCache: async () => {},
}));
vi.mock("~/lib/review/review-client", async (original) => ({
  ...(await original<typeof import("~/lib/review/review-client")>()),
  reviewClient: {
    progress: async () => ({ progress: [], attempts: [] }),
    question: () => new Promise(() => {}),
  },
}));
vi.mock("~/lib/sync/book-chapter-uploads", () => ({ reuploadBookChapters: async () => {} }));

const stores: AppStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
});

async function setup() {
  const docs = [
    '   <p id="first">Prefix  😀   text.</p><h2 id="second">Second</h2><p id="tail">second body</p>',
    '<p id="continued">continued body</p>',
    '<h1 id="final">Final</h1><p>end</p>',
  ].map((html) => {
    const doc = new Window().document as unknown as Document;
    doc.body.innerHTML = html;
    return doc;
  });
  const publication: Publication = {
    metadata: { title: "Fragments and continuations", languages: ["en"], authors: [] },
    readingOrder: docs.map((_, i) => ({
      href: normalizePublicationPath(`${i}.xhtml`),
      rel: [],
      properties: [],
    })),
    toc: [],
    resources: [],
    landmarks: [],
    diagnostics: [],
  };
  const start = (spineIndex: number, fragment: string | null = null, textOffset = 0) => ({
    spineIndex,
    href: `${spineIndex}.xhtml`,
    fragment,
    textOffset,
  });
  const second = start(0, "second", collectReviewAnchorOffsets(docs[0]!)["second"]!);
  const units: ReviewNavigationUnit[] = [
    {
      boundary: {
        key: "review-v1:0:0",
        title: "First",
        start: start(0),
        end: second,
        startOffset: 0,
        endOffset: second.textOffset,
      },
      chapterIndex: 0,
      fingerprint,
    },
    {
      boundary: {
        key: `review-v1:0:${second.textOffset}`,
        title: "Second",
        start: second,
        end: start(2),
        startOffset: second.textOffset,
        endOffset: 100,
      },
      chapterIndex: 0,
      fingerprint,
    },
    {
      boundary: {
        key: "review-v1:2:0",
        title: "Final",
        start: start(2),
        end: null,
        startOffset: 0,
        endOffset: 50,
      },
      chapterIndex: 1,
      fingerprint,
    },
  ];
  const source = new ReviewNavigationSource(publication, units, docs);
  const store = createAppStore();
  store.init();
  stores.push(store);
  store.runSaga(createReviewsSaga(store));
  store.dispatch(authSessionResolved({ id: "user-1", displayName: null }));
  store.dispatch(openReviewBook("book-1", "reader-1"));
  await vi.waitFor(() => expect(store.state.reviews.localStatus).toBe("ready"));
  store.dispatch(
    reviewLocalSourcesObserved(
      "reader-1",
      Object.fromEntries(units.map((u) => [u.boundary.key, u.fingerprint])),
    ),
  );
  store.dispatch(setReviewsEnabled("book-1", true));
  let layout = "spread:1000:800";
  const policy = new ReviewNavigation(store, "book-1", "reader-1", source, () => layout);
  let unit = units[0]!;
  let spineIndex = 0;
  const cfi = (index: number, id: string) => {
    const range = docs[index]!.createRange();
    range.selectNodeContents(docs[index]!.getElementById(id)!);
    range.collapse(true);
    return generateCfi(range, { spineIndex: index });
  };
  let currentCfi: string = cfi(0, "first");
  const navigator = {
    get currentContentRange() {
      return { key: unit.boundary.key };
    },
    get currentRelocation() {
      return {
        spineIndex,
        href: normalizePublicationPath(`${spineIndex}.xhtml`),
        localProgression: 0.75,
        totalProgression: 0.5,
      };
    },
    display: vi.fn(async (target: DisplayTarget) => {
      const admitted = policy.resolve(target);
      if (admitted) {
        spineIndex = source.spineIndex(admitted);
        unit = source.unitForTarget(admitted)!;
        currentCfi =
          admitted.cfi ??
          cfi(
            spineIndex,
            spineIndex === 1
              ? "continued"
              : spineIndex === 2
                ? "final"
                : unit === units[0]
                  ? "first"
                  : "second",
          );
      }
      return navigator.currentRelocation;
    }),
  };
  policy.rendition = {
    navigator,
    get location() {
      return { start: { cfi: currentCfi } };
    },
  } as unknown as SuccessorRenditionAdapter;
  return {
    policy,
    store,
    source,
    units,
    docs,
    cfi,
    navigator,
    selectUnit: (index: number, spine: number, id: string) => {
      unit = units[index]!;
      spineIndex = spine;
      currentCfi = cfi(spine, id);
    },
    changeLayout: () => {
      layout = "single:400:600";
    },
    start: () => policy.boundary("next", navigator.currentRelocation),
  };
}

describe("one review admission policy", () => {
  it("maps rendered CFI/fragment anchors without conflating source trim, whitespace or UTF-16 offsets", async () => {
    const { source, units, cfi } = await setup();
    expect(source.unitForTarget({ spineIndex: 0, cfi: cfi(0, "first") })).toBe(units[0]);
    expect(source.unitForTarget({ spineIndex: 0, cfi: cfi(0, "second") })).toBe(units[1]);
    expect(source.unitForTarget({ href: normalizePublicationPath("0.xhtml#second") })).toBe(
      units[1],
    );
    expect(source.unitForTarget({ spineIndex: 1 })).toBe(units[1]);
    expect(source.unitForTarget({ spineIndex: 2 })).toBe(units[2]);
  });

  it("does not reveal an unbounded spine when a fragment or restored CFI is invalid", async () => {
    const s = await setup();
    for (const target of [
      { spineIndex: 0, fragment: "missing" },
      { spineIndex: 0, cfi: "epubcfi(broken)" },
    ]) {
      expect(() => s.policy.resolve(target)).toThrow(RangeError);
      expect(s.policy.allowCommit(target)).toBe(false);
      expect(s.policy.resolve(s.policy.fallbackTarget(target))).toMatchObject({
        contentRange: { key: s.units[0]!.boundary.key },
      });
    }
  });

  it("starts once on rapid endpoint attempts and blocks TOC, links, CFIs, search/bookmark/note and position jumps", async () => {
    const s = await setup();
    expect(s.start()).toBe(false);
    await vi.waitFor(() =>
      expect(s.store.reviewsSelectors.selectReviewLocked.select(s.store.state, "book-1")).toBe(
        true,
      ),
    );
    const locator = s.store.reviewsSelectors.selectReviewCheckpoint.select(
      s.store.state,
      "book-1",
    )!.returnLocator;
    for (let i = 0; i < 10; i++) expect(s.start()).toBe(false);
    for (const target of [
      { spineIndex: 1 },
      { href: normalizePublicationPath("2.xhtml") },
      { href: normalizePublicationPath("0.xhtml#second") },
      { spineIndex: 0, cfi: s.cfi(0, "second") },
      { spineIndex: 2, localProgression: 0.5 },
    ]) {
      expect(s.policy.resolve(target)).toBe(false);
      expect(s.policy.allowCommit(target)).toBe(false);
    }
    expect(s.policy.resolve({ spineIndex: 0, cfi: s.cfi(0, "first") })).not.toBe(false);
    expect(s.policy.allowMovement("next")).toBe(false);
    expect(s.policy.allowMovement("speedread")).toBe(false);
    expect(
      s.store.reviewsSelectors.selectReviewCheckpoint.select(s.store.state, "book-1")!
        .returnLocator,
    ).toBe(locator);
    s.store.dispatch(backtrackReview("book-1"));
    expect(s.policy.allowMovement("previous")).toBe(true);
    expect(s.policy.boundary("previous", s.navigator.currentRelocation)).toBe(false);
  });

  it("waits through continuation spines, triggers the final chapter, and restores the captured continuation locator", async () => {
    const s = await setup();
    s.selectUnit(1, 0, "tail");
    expect(s.start()).toBeUndefined();
    s.selectUnit(1, 1, "continued");
    expect(s.start()).toBe(false);
    await vi.waitFor(() =>
      expect(s.store.reviewsSelectors.selectReviewVisible.select(s.store.state, "book-1")).toBe(
        true,
      ),
    );
    await s.policy.backToChapter();
    expect(s.navigator.display).toHaveBeenLastCalledWith(
      expect.objectContaining({
        spineIndex: 1,
        cfi: s.cfi(1, "continued"),
        localProgression: 0.75,
      }),
    );
    s.policy.showQuestion();
    s.changeLayout();
    await s.policy.backToChapter();
    expect(s.navigator.display.mock.lastCall![0].localProgression).toBeUndefined();
    s.store.dispatch(setReviewsEnabled("book-1", false));
    expect(s.policy.resolve({ spineIndex: 2 })).not.toBe(false);
    expect(s.policy.allowMovement("speedread")).toBe(true);
  });

  it("triggers final publication end without a synthetic next target", async () => {
    const s = await setup();
    s.selectUnit(2, 2, "final");
    expect(s.start()).toBe(false);
    await vi.waitFor(() =>
      expect(
        s.store.reviewsSelectors.selectReviewCheckpoint.select(s.store.state, "book-1")?.key,
      ).toBe(s.units[2]!.boundary.key),
    );
  });

  it("uses the saved allowed locator for an out-of-chapter restored/synced position", async () => {
    const s = await setup();
    s.selectUnit(1, 1, "continued");
    s.start();
    await vi.waitFor(() =>
      expect(s.store.reviewsSelectors.selectReviewLocked.select(s.store.state, "book-1")).toBe(
        true,
      ),
    );
    const restored = s.policy.initialTarget({ spineIndex: 2, cfi: s.cfi(2, "final") });
    expect(restored).toMatchObject({ spineIndex: 1, cfi: s.cfi(1, "continued") });
    expect(s.policy.resolve({ spineIndex: 0 })).toBe(false); // Same spine start is outside a later fragment.
  });

  it("closes only the owning reader and denies pending/hydrating and stale readers", async () => {
    const s = await setup();
    s.store.dispatch(openReviewBook("book-2", "reader-2"));
    expect(s.policy.resolve({ spineIndex: 0 })).toBe(false);
    expect(s.policy.allowMovement("next")).toBe(false);
    const before = s.store.state.reviews;
    s.store.dispatch(closeReviewBook("reader-1"));
    s.store.dispatch(reviewLocalSourcesObserved("reader-1", {}));
    expect(s.store.state.reviews).toBe(before);
  });

  it("rehydrates a checkpoint into a new reader and rejects replaced or missing return sources", async () => {
    const s = await setup();
    s.selectUnit(1, 1, "continued");
    s.start();
    await vi.waitFor(() =>
      expect(s.store.state.reviews.cache?.activeChapterKey).toBe(s.units[1]!.boundary.key),
    );
    const cache = structuredClone(s.store.state.reviews.cache!);
    s.policy.destroy();
    s.store.dispatch(closeReviewBook("reader-1"));
    s.store.dispatch(openReviewBook("book-1", "reader-reloaded"));
    s.store.dispatch(reviewCacheLoaded(s.store.state.reviews.generation, cache));
    s.store.dispatch(
      reviewLocalSourcesObserved(
        "reader-reloaded",
        Object.fromEntries(s.units.map((u) => [u.boundary.key, u.fingerprint])),
      ),
    );
    const reloaded = new ReviewNavigation(
      s.store,
      "book-1",
      "reader-reloaded",
      s.source,
      () => "spread:1000:800",
    );
    expect(reloaded.initialTarget({ spineIndex: 2 })).toMatchObject({
      spineIndex: 1,
      cfi: s.cfi(1, "continued"),
      localProgression: 0.75,
    });
    const replacedSource = new ReviewNavigationSource(
      s.source.publication,
      s.units.map((u) => ({ ...u, fingerprint: "new-source" })),
      s.docs,
    );
    const replaced = new ReviewNavigation(
      s.store,
      "book-1",
      "reader-reloaded",
      replacedSource,
      () => "spread:1000:800",
    );
    expect(replaced.initialTarget({ spineIndex: 2 })).toMatchObject({
      spineIndex: 0,
      fragment: "second",
      position: "start",
    });
    expect(replaced.initialTarget({ spineIndex: 2 }).cfi).toBeUndefined();
    const missing = new ReviewNavigation(
      s.store,
      "book-1",
      "reader-reloaded",
      new ReviewNavigationSource(s.source.publication, [], s.docs),
      () => "same",
    );
    expect(() => missing.initialTarget({ spineIndex: 2 })).toThrow("unavailable");
    s.store.dispatch(setReviewsEnabled("book-1", false));
    expect(missing.initialTarget({ spineIndex: 2 })).toEqual({ spineIndex: 2 });
  });

  it("does not hide a new account's review when an old return finishes", async () => {
    const s = await setup();
    s.start();
    await vi.waitFor(() => expect(s.store.state.reviews.cache?.presentation).toBe("review"));
    let finish!: () => void;
    s.navigator.display.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(s.navigator.currentRelocation);
        }),
    );
    const restoring = s.policy.backToChapter();
    expect(s.policy.allowMovement("next")).toBe(false);
    s.store.dispatch(authSessionResolved({ id: "user-2", displayName: null }));
    await vi.waitFor(() => expect(s.store.state.reviews.localStatus).toBe("ready"));
    s.store.dispatch(setReviewsEnabled("book-1", true));
    s.start();
    await vi.waitFor(() => expect(s.store.state.reviews.cache?.presentation).toBe("review"));
    finish();
    await restoring;
    expect(s.store.state.reviews.cache?.presentation).toBe("review");
  });

  it("requires current local source as well as server confirmation before a historical pass releases navigation", async () => {
    const s = await setup();
    s.start();
    await vi.waitFor(() =>
      expect(s.store.reviewsSelectors.selectReviewLocked.select(s.store.state, "book-1")).toBe(
        true,
      ),
    );
    const response = questionResponse("book-1", "user-1", s.units[0]!.boundary);
    const attempt = submitResponse({
      id: "attempt",
      bookId: "book-1",
      chapterKey: response.chapter.chapterKey,
      questionId: response.question.id,
      grading: "reading_group",
      document: answerDocument(),
      plainText: "A thoughtful answer with more than thirty characters.",
    });
    const { reviewQuestionReceived } = await import("~/lib/themis/reviews/reviews-slice");
    const generation = s.store.state.reviews.generation;
    const token = s.store.state.reviews.requests.question.token!;
    s.store.dispatch(reviewQuestionReceived(generation, token, response));
    s.store.dispatch(reviewRequestStarted(generation, "progress", "confirmed"));
    s.store.dispatch(
      reviewProgressReceived(generation, "confirmed", {
        progress: [attempt.progress],
        attempts: [attempt.attempt],
      }),
    );
    expect(s.store.reviewsSelectors.selectReviewLocked.select(s.store.state, "book-1")).toBe(false);
    expect(s.policy.resolve({ spineIndex: 2 })).not.toBe(false);
    s.store.dispatch(reviewRequestStarted(generation, "progress", "reconfirm"));
    expect(s.policy.resolve({ spineIndex: 2 })).toBe(false);
    expect(s.start()).toBe(false);
    await s.policy.continueReading();
    expect(s.navigator.display).not.toHaveBeenCalled();
    s.store.dispatch(
      reviewLocalSourcesObserved("reader-1", { [response.chapter.chapterKey]: "replaced-text" }),
    );
    expect(s.store.reviewsSelectors.selectReviewLocked.select(s.store.state, "book-1")).toBe(true);
    expect(s.policy.resolve({ spineIndex: 2 })).toBe(false);
  });
});
