import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { openMobileReadingTab } from "~/components/reading-shell/mobile-reading-tabs";
import { useWorkspace } from "~/lib/context/workspace-context";
import { getBookReadingPath, getReadingBookId } from "~/lib/reading-route";
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
  const location = useLocation();
  const store = useAppStore();
  const workspace = useWorkspace();
  const pendingReadingPathRef = useRef<string | null>(null);

  useEffect(() => {
    pendingReadingPathRef.current = null;
  }, [location.pathname]);

  const navigateToBook = useCallback(
    (book: BookMeta) => {
      if (getReadingBookId(location.pathname) === book.id) return;

      const readingPath = getBookReadingPath(book.id);
      if (pendingReadingPathRef.current === readingPath) return;

      pendingReadingPathRef.current = readingPath;
      void navigate(readingPath);
    },
    [location.pathname, navigate],
  );

  const openBook = useCallback(
    (book: BookMeta) => {
      store.dispatch(recordBookOpened(book.id));
      workspace.setActiveCluster(book.id);
      navigateToBook(book);
    },
    [navigateToBook, store, workspace],
  );

  const openReadingTool = useCallback(
    (book: BookMeta, tab: "Notes" | "Discuss" | "Outline") => {
      openMobileReadingTab(tab, book.id);
      navigateToBook(book);
    },
    [navigateToBook],
  );

  const openNotebook = useCallback(
    (book: BookMeta) => openReadingTool(book, "Notes"),
    [openReadingTool],
  );

  const openChat = useCallback(
    (book: BookMeta) => openReadingTool(book, "Discuss"),
    [openReadingTool],
  );

  const openReadingHistory = useCallback(() => {}, []);

  const openOutline = useCallback(
    (book: BookMeta) => openReadingTool(book, "Outline"),
    [openReadingTool],
  );

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
