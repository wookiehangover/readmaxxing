import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { booksSaga } from "~/lib/themis/books/books-sagas";
import { hydrateBooks } from "~/lib/themis/books/books-slice";
import { createAppStore, type AppStore } from "~/lib/themis/store";

const AppStoreContext = createContext<AppStore | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => (typeof window === "undefined" ? null : createAppStore()));

  useEffect(() => {
    if (!store) return;
    const disposeStore = store.init();
    const cancelBooksSaga = store.runSaga(booksSaga);
    store.dispatch(hydrateBooks());

    return () => {
      cancelBooksSaga();
      disposeStore();
    };
  }, [store]);

  return <AppStoreContext.Provider value={store}>{children}</AppStoreContext.Provider>;
}

export function useAppStore() {
  const store = useContext(AppStoreContext);
  if (!store) {
    throw new Error("AppStore is only available in the client React tree");
  }
  return store;
}
