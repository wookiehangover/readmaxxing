import { describe, expect, it } from "vitest";
import { createAppStore } from "../store";
import {
  authSessionCleared,
  authSessionResolved,
  logoutRequested,
} from "../auth-session/auth-session-slice";
import {
  recoveryInitialState,
  syncRecoveryReducer,
  recoveryLoaded,
  selectRecovery,
  recoveryViewLoaded,
  recoveryCommandStarted,
  recoveryFailed,
} from "./sync-recovery-slice";
import type { RecoveryItem } from "./sync-recovery-types";

const item: RecoveryItem = {
  id: "device:item",
  source: "device",
  sourceId: "item",
  entity: "notes",
  entityId: "book",
  state: "needs-account-binding",
  reason: "intended",
  recordedAt: "2026-01-01",
  receiptId: null,
};
describe("recovery metadata state", () => {
  it("keeps one normalized record, derives selection, and serializes without raw data", () => {
    const store = createAppStore();
    store.init();
    try {
      store.dispatch(recoveryLoaded([item], null));
      store.dispatch(selectRecovery(item.id));
      expect(store.syncRecoverySelectors.selectRecoveryItems.select(store.state)).toEqual([item]);
      expect(store.syncRecoverySelectors.selectRecoveryItem.select(store.state)).toBe(
        store.state.syncRecovery.items.map[item.id],
      );
      expect(JSON.parse(JSON.stringify(store.state.syncRecovery))).toEqual(
        store.state.syncRecovery,
      );
      expect(syncRecoveryReducer(store.state.syncRecovery, { type: "unrelated" })).toBe(
        store.state.syncRecovery,
      );
    } finally {
      store.dispose();
    }
  });
  it("clears selected document handles and request state immediately on account boundaries", () => {
    let state = syncRecoveryReducer(recoveryInitialState, recoveryLoaded([item], null));
    state = syncRecoveryReducer(state, selectRecovery(item.id));
    state = syncRecoveryReducer(
      state,
      recoveryViewLoaded({
        token: "view",
        url: "blob:private",
        attachmentCount: 0,
        localVersion: "reviewed",
      }),
    );
    state = syncRecoveryReducer(state, recoveryCommandStarted());
    for (const action of [
      authSessionCleared(),
      authSessionResolved({ id: "B", displayName: "Other" }),
      logoutRequested(
        () => {},
        () => {},
      ),
    ]) {
      expect(syncRecoveryReducer(state, action)).toBe(recoveryInitialState);
    }
    const failed = syncRecoveryReducer(state, recoveryFailed("offline"));
    expect(failed.items).toBe(state.items);
    expect(failed.view).toBe(state.view);
    expect(failed.busy).toBe(false);
  });
});
