import { createContext, useCallback, useContext, useState, useMemo, type ReactNode } from "react";

export interface TocEntry {
  label: string;
  href: string;
  subitems?: TocEntry[];
}

interface ReaderNavigationContextValue {
  toc: TocEntry[];
  navigateToHref: (href: string) => void;
  setToc: (toc: TocEntry[]) => void;
  setNavigateToHref: (fn: (href: string) => void) => void;
}

const ReaderNavigationContext = createContext<ReaderNavigationContextValue>({
  toc: [],
  navigateToHref: () => {},
  setToc: () => {},
  setNavigateToHref: () => {},
});

export function ReaderNavigationProvider({ children }: { children: ReactNode }) {
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [navigateToHref, setNavigateToHref] = useState<(href: string) => void>(() => () => {});

  // Stable wrapper so useState doesn't treat the function as an updater.
  // setNavigateToHref from useState is already stable, so deps can be empty.
  const stableSetNavigateToHref = useCallback(
    (fn: (href: string) => void) => setNavigateToHref(() => fn),
    [],
  );

  const value = useMemo<ReaderNavigationContextValue>(
    () => ({
      toc,
      navigateToHref,
      setToc,
      setNavigateToHref: stableSetNavigateToHref,
    }),
    [toc, navigateToHref, stableSetNavigateToHref],
  );

  return (
    <ReaderNavigationContext.Provider value={value}>{children}</ReaderNavigationContext.Provider>
  );
}

export function useReaderNavigation() {
  return useContext(ReaderNavigationContext);
}
