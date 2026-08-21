import { useCallback } from "react";
import { useNavigate } from "react-router";
import { openMobileReadingTab } from "~/components/reading-shell/mobile-reading-tabs";
import { useWorkspace } from "~/lib/context/workspace-context";
import { getBookReadingPath } from "~/lib/reading-route";
import type { BookMeta } from "~/lib/stores/book-store";
import { useAppStore } from "~/lib/themis/provider";
import { recordBookOpened } from "~/lib/themis/workspace-restore/workspace-restore-slice";

export interface UseWorkspacePanelsResult {
  readonly openBook: (book: BookMeta) => void;
  readonly openNotebook: (book: BookMeta) => void;
  readonly openChat: (book: BookMeta) => void;
  readonly openOutline: (book: BookMeta) => void;
  readonly openReadingHistory: (book: BookMeta) => void;
  readonly openStandardEbooks: () => void;
  readonly closeBookPanels: (bookId: string) => void;
}

export function useWorkspacePanels(): UseWorkspacePanelsResult {
  const navigate = useNavigate();
  const store = useAppStore();
  const workspace = useWorkspace();
  const openBook = useCallback(
    (book: BookMeta) => {
      store.dispatch(recordBookOpened(book.id));
      workspace.setActiveCluster(book.id);
      void navigate(getBookReadingPath(book.id));
    },
    [navigate, store, workspace],
  );

  const openNotebook = useCallback(() => openMobileReadingTab("Notes"), []);

  const openChat = useCallback(() => openMobileReadingTab("Discuss"), []);

  const openReadingHistory = useCallback(() => {}, []);

  const openOutline = useCallback(() => openMobileReadingTab("Outline"), []);

  const openStandardEbooks = useCallback(() => {
    navigate("/standard-ebooks");
  }, [navigate]);

  const closeBookPanels = useCallback(() => {}, []);

  return {
    openBook,
    openNotebook,
    openChat,
    openOutline,
    openReadingHistory,
    openStandardEbooks,
    closeBookPanels,
  };
}
