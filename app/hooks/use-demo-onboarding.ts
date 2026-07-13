import { useEffect, useRef, useState } from "react";
import type { BookMeta } from "~/lib/stores/book-store";
import type { Settings } from "~/lib/settings";

interface UseDemoOnboardingParams {
  readonly demoBook: BookMeta | null;
  readonly layoutReady: boolean;
  readonly sidebarCollapsed: boolean;
  readonly updateSettings: (patch: Partial<Settings>) => void;
  readonly openBook: (book: BookMeta) => void;
  readonly openChat: (book: BookMeta) => void;
  readonly openNotebook: (book: BookMeta) => void;
}

export function useDemoOnboarding({
  demoBook,
  layoutReady,
  sidebarCollapsed,
  updateSettings,
  openBook,
  openChat,
  openNotebook,
}: UseDemoOnboardingParams): boolean {
  const [bootstrapReady, setBootstrapReady] = useState(demoBook === null);
  const didBootstrapRef = useRef(false);

  useEffect(() => {
    if (!demoBook || !layoutReady || didBootstrapRef.current) return;
    if (!sidebarCollapsed) {
      updateSettings({ sidebarCollapsed: true });
      return;
    }

    didBootstrapRef.current = true;
    openBook(demoBook);
    openChat(demoBook);
    openNotebook(demoBook);
    setBootstrapReady(true);
  }, [demoBook, layoutReady, openBook, openChat, openNotebook, sidebarCollapsed, updateSettings]);

  return bootstrapReady;
}
