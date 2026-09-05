import { call, put, takeEvery } from "typed-redux-saga";
import { readingRailRestored, selectReadingRailTab } from "../reading-rail-slice";
import {
  READING_RAIL_TABS,
  type ReadingRailState,
  type ReadingRailTab,
} from "../reading-rail-types";

const prefix = "reading-shell:mobile-tab:";
function restore() {
  const selections: ReadingRailState["selections"] = {};
  try {
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const value = window.sessionStorage.getItem(key);
      if (value !== "Details" && READING_RAIL_TABS.includes(value as ReadingRailTab))
        selections[key.slice(prefix.length)] = value as ReadingRailTab;
    }
  } catch {
    /* Tab memory is optional when browser storage is unavailable. */
  }
  return selections;
}
function persist(scope: string, tab: ReadingRailTab) {
  // Details is transient; retain the last reading section across reloads.
  if (tab === "Details") return;
  try {
    window.sessionStorage.setItem(`${prefix}${scope}`, tab);
  } catch {
    /* Keep in-memory selection usable. */
  }
}
export function* readingRailSaga() {
  yield* put(readingRailRestored(yield* call(restore)));
  yield* takeEvery(selectReadingRailTab, function* ({ payload: [scope, tab] }) {
    yield* call(persist, scope, tab);
  });
}
