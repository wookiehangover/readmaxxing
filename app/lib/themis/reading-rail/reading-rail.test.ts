import { afterEach, describe, expect, it } from "vitest";
import { createAppStore, type AppStore } from "~/lib/themis/store";
import { authSessionResolved } from "~/lib/themis/auth-session/auth-session-slice";
import { emptyReviewCache } from "~/lib/themis/reviews/reviews-records";
import { boundary } from "~/lib/themis/reviews/reviews-test-fixtures";
import {
  backtrackReview,
  openReviewBook,
  reviewCacheLoaded,
  reviewCheckpointEntered,
  setReviewsEnabled,
} from "~/lib/themis/reviews/reviews-slice";
import {
  readingRailReducer,
  readingRailRestored,
  selectReadingRailTab,
} from "./reading-rail-slice";
import { readingRailSaga } from "./sagas/reading-rail-saga";
let store: AppStore | undefined;
afterEach(() => {
  store?.dispose();
  store = undefined;
  window.sessionStorage.clear();
});
function setup() {
  store = createAppStore();
  store.init();
  return store;
}

describe("canonical rail selection", () => {
  it("preserves no-op identity and stores section selection separately from transient Details", () => {
    const state = readingRailReducer(undefined, selectReadingRailTab("book", "Outline"));
    expect(readingRailReducer(state, selectReadingRailTab("book", "Outline"))).toBe(state);
    const details = readingRailReducer(state, selectReadingRailTab("book", "Details", "mount"));
    expect(details.selections.book).toBe("Outline");
    expect(details.detailsOwner).toBe(JSON.stringify(["book", "mount"]));
    expect(readingRailReducer(details, readingRailRestored({ book: "Discuss" }))).toBe(details);
    expect(structuredClone(details)).toEqual(details);
  });
  it("derives Review replacement throughout backtracking, preserves Notes, and excludes public/PDF scopes", () => {
    const app = setup();
    app.dispatch(authSessionResolved({ id: "user", displayName: null }));
    app.dispatch(openReviewBook("book"));
    app.dispatch(reviewCacheLoaded(app.state.reviews.generation, emptyReviewCache("user", "book")));
    const selected = (mobile = false, privateBookId: string | null = "book") =>
      app.readingRailSelectors.selectActiveReadingRailTab.select(
        app.state,
        "book",
        mobile,
        privateBookId,
        "mount",
      );
    expect(selected()).toBe("Notes");
    app.dispatch(selectReadingRailTab("other-book", "Details", "mount"));
    expect(selected()).toBe("Notes");
    app.dispatch(selectReadingRailTab("book", "Details", "mount"));
    expect(selected()).toBe("Details");
    app.dispatch(selectReadingRailTab("book", "Read"));

    expect(selected(true)).toBe("Read");
    app.dispatch(selectReadingRailTab("book", "Discuss"));
    app.dispatch(setReviewsEnabled("book", true));
    app.dispatch(reviewCheckpointEntered("book", 0, boundary, "locator"));
    expect(selected()).toBe("Review");
    app.dispatch(backtrackReview("book"));
    expect(selected()).toBe("Review");
    app.dispatch(selectReadingRailTab("book", "Notes"));
    expect(selected()).toBe("Notes");
    app.dispatch(selectReadingRailTab("book", "Outline"));
    expect(selected()).toBe("Review");
    app.dispatch(setReviewsEnabled("book", false));
    expect(selected()).toBe("Outline");
    app.dispatch(selectReadingRailTab("book", "Review"));
    expect(selected(false, null)).toBe("Notes");
    expect(selected(true, null)).toBe("Read");
  });
  it("restores and persists per-book sections through the real saga, ignoring legacy Details", () => {
    window.sessionStorage.setItem("reading-shell:mobile-tab:a", "Outline");
    window.sessionStorage.setItem("reading-shell:mobile-tab:b", "Details");
    const app = setup();
    app.runSaga(readingRailSaga);
    expect(app.state.readingRail.selections).toEqual({ a: "Outline" });
    app.dispatch(selectReadingRailTab("a", "Notes"));
    app.dispatch(selectReadingRailTab("a", "Details", "mount"));
    expect(window.sessionStorage.getItem("reading-shell:mobile-tab:a")).toBe("Notes");
    app.dispatch(selectReadingRailTab("b", "Discuss"));
    expect(app.state.readingRail.selections).toEqual({ a: "Notes", b: "Discuss" });
  });
});
