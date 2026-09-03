import type { AppStoreCore } from "~/lib/themis/store";
import type { createReviewsSelectors } from "~/lib/themis/reviews/reviews-selectors";
import type { ReadingRailTab } from "./reading-rail-types";

export function createReadingRailSelectors(
  store: AppStoreCore,
  reviews: ReturnType<typeof createReviewsSelectors>,
) {
  const selectActiveReadingRailTab = store.createSelector(
    (
      state,
      scope: string,
      mobile: boolean,
      privateBookId: string | null,
      owner: string,
    ): ReadingRailTab => {
      if (
        state.readingRail.detailsOwner === JSON.stringify([scope, owner]) ||
        state.readingRail.detailsOwner === JSON.stringify([scope, null])
      )
        return "Details";
      const selected = state.readingRail.selections[scope];
      const locked =
        privateBookId !== null && reviews.selectReviewLocked.select(state, privateBookId);
      if (locked && (selected === "Discuss" || selected === "Outline" || (!selected && !mobile)))
        return "Review";
      if (selected === "Review" && !privateBookId) return mobile ? "Read" : "Notes";
      if (!mobile && selected === "Read") return "Notes";
      return selected ?? (mobile ? "Read" : "Notes");
    },
  );
  return { selectActiveReadingRailTab };
}
