import { createContext, useCallback, useContext, useId, type ReactNode } from "react";
import { useAppStore } from "~/lib/themis/provider";
import { selectReadingRailTab } from "~/lib/themis/reading-rail/reading-rail-slice";
import type { ReadingRailTab } from "~/lib/themis/reading-rail/reading-rail-types";

// Context carries rendering scope only. Selection and tab eligibility live in Redux.
const ReadingRailContext = createContext({
  scope: "",
  owner: "",
  mobile: false,
  privateBookId: null as string | null,
});
export function ReadingRailProvider({
  children,
  scope,
  mobile = false,
  privateBookId = null,
}: {
  children: ReactNode;
  scope: string;
  mobile?: boolean;
  privateBookId?: string | null;
}) {
  const owner = useId();
  return (
    <ReadingRailContext.Provider value={{ scope, owner, mobile, privateBookId }}>
      {children}
    </ReadingRailContext.Provider>
  );
}
export function useReadingRail() {
  const store = useAppStore();
  const context = useContext(ReadingRailContext);
  // This scope hook preserves the plain-value contract consumed by Base UI tabs/menu.
  const activeTab = store.readingRailSelectors.selectActiveReadingRailTab.useValue(
    context.scope,
    context.mobile,
    context.privateBookId,
    context.owner,
  );
  const setActiveTab = useCallback(
    (tab: ReadingRailTab) => {
      store.dispatch(selectReadingRailTab(context.scope, tab, context.owner));
    },
    [store, context.scope, context.owner],
  );
  return { ...context, activeTab, setActiveTab };
}
