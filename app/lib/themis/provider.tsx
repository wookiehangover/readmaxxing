import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { createAppStore, type AppStore } from "~/lib/themis/store";

const AppStoreContext = createContext<AppStore | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => (typeof window === "undefined" ? null : createAppStore()));

  useEffect(() => {
    if (!store) return;
    return store.init();
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
