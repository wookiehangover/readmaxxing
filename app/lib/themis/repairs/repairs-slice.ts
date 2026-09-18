import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
import type { SyncActions } from "~/lib/sync/use-sync";
import type { BookRepairState, RepairsState } from "./repairs-types";

export const startRepair = createAction<[bookId: string]>("repairs/start");
export const resumeRepair = createAction<[bookId: string]>("repairs/resume");
export const saveRepair =
  createAction<[bookId: string, mode: "download" | "replace", sync: SyncActions]>("repairs/save");
export const repairChanged =
  createAction<[bookId: string, patch: Partial<BookRepairState>]>("repairs/changed");
export const clearRepairs = createAction("repairs/clear");
export const emptyBookRepair: BookRepairState = {
  job: null,
  operation: null,
  error: null,
  replaced: false,
};
const reducer = createReducer<RepairsState>({ byBookId: {} });
reducer.with(repairChanged, (state, { payload: [bookId, patch] }) => {
  const previous = state.byBookId[bookId] ?? emptyBookRepair;
  if (
    Object.entries(patch).every(([key, value]) => previous[key as keyof BookRepairState] === value)
  )
    return state;
  return { byBookId: { ...state.byBookId, [bookId]: { ...previous, ...patch } } };
});
reducer.with(clearRepairs, (state) =>
  Object.keys(state.byBookId).length ? { byBookId: {} } : state,
);
export const repairsReducer = reducer;
