import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspacePanels, type UseWorkspacePanelsResult } from "~/hooks/use-workspace-panels";
import type { BookMeta } from "~/lib/stores/book-store";
import { recordBookOpened } from "~/lib/themis/workspace-restore/workspace-restore-slice";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  navigate: vi.fn(),
  openReadingTab: vi.fn(),
  setActiveCluster: vi.fn(),
}));

vi.mock("react-router", () => ({ useNavigate: () => mocks.navigate }));
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
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe("route-based workspace actions", () => {
  it("records, activates, and navigates when opening a book", () => {
    renderWorkspacePanels().openBook(book);

    expect(mocks.dispatch).toHaveBeenCalledWith(recordBookOpened(book.id));
    expect(mocks.setActiveCluster).toHaveBeenCalledWith(book.id);
    expect(mocks.navigate).toHaveBeenCalledWith("/books/book-a");
  });

  it("opens notes, chat, and outline through reading rail tabs", () => {
    const panels = renderWorkspacePanels();

    panels.openNotebook(book);
    panels.openChat(book);
    panels.openOutline(book);

    expect(mocks.openReadingTab.mock.calls).toEqual([["Notes"], ["Discuss"], ["Outline"]]);
  });
});
