import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDemoOnboarding } from "~/hooks/use-demo-onboarding";
import { useWorkspacePanels, type UseWorkspacePanelsResult } from "~/hooks/use-workspace-panels";
import type { BookMeta } from "~/lib/stores/book-store";
import { recordBookOpened } from "~/lib/themis/workspace-restore/workspace-restore-slice";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  navigate: vi.fn(),
  openReadingTab: vi.fn(),
  pathname: "/library",
  setActiveCluster: vi.fn(),
}));

vi.mock("react-router", () => ({
  useLocation: () => ({ pathname: mocks.pathname }),
  useNavigate: () => mocks.navigate,
}));
vi.mock("~/components/reading-shell/mobile-reading-tabs", () => ({
  openMobileReadingTab: mocks.openReadingTab,
}));
vi.mock("~/lib/context/workspace-context", () => ({
  useWorkspace: () => ({ setActiveCluster: mocks.setActiveCluster }),
}));
vi.mock("~/lib/themis/provider", () => ({
  useAppStore: () => ({ dispatch: mocks.dispatch }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const book: BookMeta = {
  id: "book-a",
  title: "Book A",
  author: "Author A",
  coverImage: null,
  format: "epub",
};

function renderWorkspacePanels(): UseWorkspacePanelsResult {
  let result: UseWorkspacePanelsResult | undefined;
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);

  function Harness() {
    result = useWorkspacePanels();
    return null;
  }

  act(() => root.render(React.createElement(Harness)));
  if (!result) throw new Error("useWorkspacePanels did not return a result");
  return result;
}

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots.length = 0;
  document.body.innerHTML = "";
  mocks.dispatch.mockReset();
  mocks.navigate.mockReset();
  mocks.openReadingTab.mockReset();
  mocks.setActiveCluster.mockReset();
  mocks.pathname = "/library";
});

describe("route-based workspace actions", () => {
  it("records, activates, and navigates when opening a book", () => {
    renderWorkspacePanels().openBook(book);

    expect(mocks.dispatch).toHaveBeenCalledWith(recordBookOpened(book.id));
    expect(mocks.setActiveCluster).toHaveBeenCalledWith(book.id);
    expect(mocks.navigate).toHaveBeenCalledWith("/books/book-a");
  });

  it("records and activates an already-open book without navigating again", () => {
    mocks.pathname = "/books/book-a";

    renderWorkspacePanels().openBook(book);

    expect(mocks.dispatch).toHaveBeenCalledWith(recordBookOpened(book.id));
    expect(mocks.setActiveCluster).toHaveBeenCalledWith(book.id);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("navigates once when demo onboarding opens the book, notebook, and chat together", () => {
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    roots.push(root);

    function DemoOnboardingHarness() {
      const { openBook, openNotebook, openChat } = useWorkspacePanels();

      useDemoOnboarding({
        demoBook: book,
        layoutReady: true,
        sidebarCollapsed: true,
        updateSettings: vi.fn(),
        openBook,
        openNotebook,
        openChat,
      });
      return null;
    }

    act(() => root.render(React.createElement(DemoOnboardingHarness)));

    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith("/books/book-a");
    expect(mocks.openReadingTab.mock.calls).toEqual([
      ["Notes", "book-a"],
      ["Discuss", "book-a"],
    ]);
  });

  it("opens notes, chat, and outline through reading rail tabs", () => {
    const panels = renderWorkspacePanels();

    panels.openNotebook(book);
    panels.openChat(book);
    panels.openOutline(book);

    expect(mocks.openReadingTab.mock.calls).toEqual([
      ["Notes", "book-a"],
      ["Discuss", "book-a"],
      ["Outline", "book-a"],
    ]);
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith("/books/book-a");
  });

  it.each([
    ["openNotebook", "Notes"],
    ["openChat", "Discuss"],
  ] as const)("navigates when %s opens a book from outside the reading route", (action, tab) => {
    renderWorkspacePanels()[action](book);

    expect(mocks.openReadingTab).toHaveBeenCalledWith(tab, "book-a");
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith("/books/book-a");
  });

  it("switches the rail immediately without navigating when already reading the book", () => {
    mocks.pathname = "/books/book-a";

    renderWorkspacePanels().openChat(book);

    expect(mocks.openReadingTab).toHaveBeenCalledWith("Discuss", "book-a");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
