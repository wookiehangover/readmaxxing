import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
import type { ReadingRailState, ReadingRailTab } from "./reading-rail-types";

export const selectReadingRailTab =
  createAction<[scope: string, tab: ReadingRailTab, owner?: string]>("readingRail/selectTab");
export const readingRailRestored =
  createAction<[selections: ReadingRailState["selections"]]>("readingRail/restored");
const reducer = createReducer<ReadingRailState>({ selections: {}, detailsOwner: null });
reducer.with(selectReadingRailTab, (state, { payload: [scope, tab, owner] }) => {
  const detailsOwner = JSON.stringify([scope, owner ?? null]);
  if (tab === "Details")
    return state.detailsOwner === detailsOwner ? state : { ...state, detailsOwner };
  return state.selections[scope] === tab && state.detailsOwner === null
    ? state
    : { detailsOwner: null, selections: { ...state.selections, [scope]: tab } };
});
reducer.with(readingRailRestored, (state, { payload: [selections] }) =>
  Object.keys(selections).some((scope) => !(scope in state.selections))
    ? { ...state, selections: { ...selections, ...state.selections } }
    : state,
);
export const readingRailReducer = reducer;
