import type { AppStoreCore } from "~/lib/themis/store";

export function createAuthSessionSelectors(store: AppStoreCore) {
  return {
    selectAuthUser: store.createSelector((state) => state.authSession.user),
    selectIsAuthenticated: store.createSelector((state) => state.authSession.user !== null),
    selectAuthLoading: store.createSelector((state) => state.authSession.loading),
  };
}
