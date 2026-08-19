import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { annotationsSaga } from "~/lib/themis/annotations/annotations-sagas";
import { bookmarksSaga } from "~/lib/themis/bookmarks/bookmarks-sagas";
import { booksSaga } from "~/lib/themis/books/books-sagas";
import { hydrateBooks } from "~/lib/themis/books/books-slice";
import { createAppStore, type AppStore } from "~/lib/themis/store";
import { workspaceRestoreSaga } from "~/lib/themis/workspace-restore/workspace-restore-sagas";
import { hydrateWorkspaceRestore } from "~/lib/themis/workspace-restore/workspace-restore-slice";

const AppStoreContext = createContext<AppStore | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => (typeof window === "undefined" ? null : createAppStore()));
  const [storeStarted, setStoreStarted] = useState(false);

  // React Router currently owns this client-only lifecycle here; moving init before render is a separate migration.
  // eslint-disable-next-line themis/react-component-lifecycle-boundary
  useEffect(() => {
    if (!store) return;
    const disposeStore = store.init();
    const cancelAnnotationsSaga = store.runSaga(annotationsSaga);
    const cancelBookmarksSaga = store.runSaga(bookmarksSaga);
    const cancelBooksSaga = store.runSaga(booksSaga);
    const cancelWorkspaceRestoreSaga = store.runSaga(workspaceRestoreSaga);
    store.dispatch(hydrateBooks());
    store.dispatch(hydrateWorkspaceRestore());
    setStoreStarted(true);

    return () => {
      cancelWorkspaceRestoreSaga();
      cancelBooksSaga();
      cancelBookmarksSaga();
      cancelAnnotationsSaga();
      disposeStore();
    };
  }, [store]);

  return (
    <AppStoreContext.Provider value={store}>
      {storeStarted ? children : null}
    </AppStoreContext.Provider>
  );
}

export function useAppStore() {
  const store = useContext(AppStoreContext);
  if (!store) {
    throw new Error("AppStore is only available in the client React tree");
  }
  return store;
}
