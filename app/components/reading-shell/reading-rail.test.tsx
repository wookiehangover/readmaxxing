import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readingLocation = {
  chapterLabel: "Part III, Chapter VII",
  currentPage: 283,
  totalPages: 1164,
};

const tocEntries = [{ label: "Chapter One", href: "chapter-1.xhtml" }];
const navigateToToc = vi.hoisted(() => vi.fn());

const workspace = vi.hoisted(() => ({
  activeClusterBookIdRef: { current: "book-1" as string | null },
  booksRef: {
    current: [
      {
        id: "book-1",
        title: "The Power Broker",
        author: "Robert Caro",
        coverImage: null,
        format: "epub" as "epub" | "pdf",
      },
    ],
  },
  subscribeClusterChanges: () => () => {},
  subscribeReadingLocations: () => () => {},
  getReadingLocation: () => readingLocation,
  findTocForBook: () => tocEntries,
  findTocNavigationForBook: () => navigateToToc,
}));

vi.mock("~/lib/context/workspace-context", () => ({
  useWorkspace: () => workspace,
  useOptionalWorkspace: () => null,
}));
vi.mock("~/lib/context/auth-context", () => ({
  useAuth: () => ({ isAuthenticated: false }),
}));
vi.mock("~/lib/context/reading-chat-menu-context", () => ({
  useReadingChatMenuActions: () => null,
}));
vi.mock("~/components/share-dialog", () => ({ ShareDialog: () => null }));
vi.mock("~/components/workspace/panel-components", () => ({
  WorkspaceNotebookPanel: ({ chromeless }: { chromeless?: boolean }) => (
    <div data-testid="notes-panel" data-chromeless={chromeless}>
      <div data-testid="notes-scroll-area" className="min-h-0 flex-1">
        <div data-testid="notes-scroll-viewport" className="size-full">
          <div data-testid="notes-scroll-content" className="pr-6 pl-6 md:pl-0">
            Notes panel
          </div>
        </div>
      </div>
    </div>
  ),
}));
vi.mock("~/components/chat/chat-panel", () => ({
  ChatPanel: () => (
    <div data-testid="chat-panel">
      <div data-testid="discuss-scroll-area" className="min-h-0 flex-1">
        <div data-testid="discuss-scroll-viewport" className="size-full">
          <div data-testid="discuss-scroll-content" className="pr-6 pl-6 md:pl-0">
            Chat panel
          </div>
        </div>
      </div>
    </div>
  ),
}));
vi.mock("~/components/workspace/outline-panel", () => ({
  WorkspaceOutlinePanel: ({ chromeless }: { chromeless?: boolean }) => (
    <div data-testid="outline-panel" data-chromeless={chromeless}>
      <div data-testid="outline-scroll-area" className="min-h-0 flex-1">
        <div data-testid="outline-scroll-viewport" className="size-full">
          <div data-testid="outline-scroll-content" className="pr-6 pl-6 md:pl-0">
            Outline panel
          </div>
        </div>
      </div>
    </div>
  ),
}));

import { ReaderSettingsMenu } from "~/components/reader-settings-menu";
import { ReadingRail } from "~/components/reading-shell/reading-rail";
import { openMobileReadingTab } from "~/components/reading-shell/mobile-reading-tabs";
import { ReadingRailMenuPortal } from "~/components/reading-shell/reading-rail-menu-portal";
import { getSettings } from "~/lib/settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function renderRail() {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(<ReadingRail />));
  return container;
}

function renderMobileRail() {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      <MemoryRouter>
        <ReadingRail mobile bookSurface={<div data-testid="book-surface">Book surface</div>} />
        <ReadingRailMenuPortal>
          <ReaderSettingsMenu
            settings={getSettings()}
            onUpdateSettings={vi.fn()}
            book={workspace.booksRef.current[0]}
            onDownload={vi.fn()}
            onBookmarkPage={vi.fn()}
          />
        </ReadingRailMenuPortal>
      </MemoryRouter>,
    ),
  );
  return container;
}

function clickTab(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label,
  );
  act(() => button?.click());
}

beforeEach(() => {
  workspace.activeClusterBookIdRef.current = "book-1";
  workspace.booksRef.current[0].title = "The Power Broker";
  workspace.booksRef.current[0].format = "epub";
  readingLocation.chapterLabel = "Part III, Chapter VII";
  readingLocation.currentPage = 283;
  readingLocation.totalPages = 1164;
  tocEntries.splice(0, tocEntries.length, {
    label: "Chapter One",
    href: "chapter-1.xhtml",
  });
  navigateToToc.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("ReadingRail", () => {
  it("mirrors the desktop rail in the mobile bottom row", () => {
    const container = renderMobileRail();
    const rail = container.firstElementChild!;
    const tabList = container.querySelector("[aria-label='Reading sections']")!;
    const tabs = Array.from(tabList.querySelectorAll("button"));
    const bottomRow = tabList.parentElement!;
    const indicator = tabList.querySelector("[role='presentation']");

    expect(tabs.map((tab) => tab.textContent)).toEqual(["Read", "Notes", "Discuss", "Outline"]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(rail.className).toContain("h-full");
    expect(rail.lastElementChild).toBe(bottomRow);
    expect(tabList.className).toContain("gap-5");
    expect(tabList.className).not.toContain("grid");
    expect(bottomRow.className).not.toContain("border-t");
    const menuSlot = bottomRow.querySelector("#reading-rail-menu");
    const menuButton = menuSlot?.querySelector<HTMLButtonElement>("button[title='Reader menu']");
    expect(menuButton?.textContent).toContain("Reader menu");
    expect(menuButton?.querySelector("svg")).not.toBeNull();
    expect(indicator?.className).toContain("left-[var(--active-tab-left)]");
    expect(indicator?.className).toContain("h-px");
    expect(indicator?.className).toContain("w-3");
    expect(indicator?.className).toContain("transition-[left]");
  });

  it("switches Read, Notes, Discuss, and Outline while keeping the book mounted", () => {
    const container = renderMobileRail();
    const bookSurface = container.querySelector("[data-testid='book-surface']");
    const readPanel = bookSurface?.closest<HTMLElement>("[role='tabpanel']");
    const panelByTab = {
      Notes: "notes-panel",
      Discuss: "chat-panel",
      Outline: "outline-panel",
    } as const;

    expect(bookSurface).not.toBeNull();
    expect(readPanel?.hidden).toBe(false);
    for (const tab of ["Notes", "Discuss", "Outline"] as const) {
      clickTab(container, tab);
      expect(
        Array.from(container.querySelectorAll("button"))
          .find((candidate) => candidate.textContent === tab)
          ?.getAttribute("aria-selected"),
      ).toBe("true");
      const activePanel = container.querySelector(
        `[data-testid='${panelByTab[tab]}']`,
      )?.parentElement;
      expect(activePanel?.hidden).toBe(false);
      expect(container.querySelector("[data-testid='book-surface']")).toBe(bookSurface);
      expect(readPanel?.hidden).toBe(true);
      expect(readPanel?.hasAttribute("data-hidden")).toBe(true);
    }

    clickTab(container, "Read");
    expect(
      Array.from(container.querySelectorAll("button"))
        .find((tab) => tab.textContent === "Read")
        ?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(container.querySelector("[data-testid='book-surface']")).toBe(bookSurface);
    expect(readPanel?.hidden).toBe(false);
    expect(readPanel?.hasAttribute("data-hidden")).toBe(false);
  });

  it("opens reader actions in the matching mobile tab", async () => {
    const container = renderMobileRail();

    openMobileReadingTab("Discuss");
    await act(async () => Promise.resolve());

    expect(
      Array.from(container.querySelectorAll("button"))
        .find((tab) => tab.textContent === "Discuss")
        ?.getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("keeps mobile tool panels and scroll viewports flush with the screen edge", () => {
    const container = renderMobileRail();
    const rail = container.firstElementChild as HTMLElement;

    for (const [tab, panelTestId, scrollId] of [
      ["Notes", "notes-panel", "notes"],
      ["Discuss", "chat-panel", "discuss"],
      ["Outline", "outline-panel", "outline"],
    ]) {
      clickTab(container, tab);
      const panel = container.querySelector(`[data-testid='${panelTestId}']`)?.parentElement;
      expect(panel?.className).toBe("min-h-0 flex-1 overflow-hidden outline-none");
      expect(panel?.classList.contains("px-6")).toBe(false);

      for (const surface of ["area", "viewport"]) {
        const scroller = container.querySelector(`[data-testid='${scrollId}-scroll-${surface}']`);
        expect(scroller?.classList.contains("px-6")).toBe(false);
        expect(scroller?.classList.contains("pl-6")).toBe(false);
        expect(scroller?.classList.contains("pr-6")).toBe(false);
      }

      const content = container.querySelector(`[data-testid='${scrollId}-scroll-content']`);
      expect(content?.classList.contains("pr-6")).toBe(true);
      expect(content?.classList.contains("pl-6")).toBe(true);
      expect(content?.classList.contains("md:pl-0")).toBe(true);

      expect(rail.contains(content)).toBe(true);
    }
  });

  it("keeps scroll viewports flush with the right edge while chrome owns its inset", () => {
    const container = renderRail();
    const rail = container.firstElementChild as HTMLElement;

    expect(rail.classList.contains("pl-6")).toBe(true);
    expect(rail.classList.contains("py-5")).toBe(true);
    expect(rail.classList.contains("px-6")).toBe(false);
    expect(rail.classList.contains("pr-6")).toBe(false);
    expect(
      container.querySelector("[aria-label='Reading tools']")?.parentElement?.className,
    ).toContain("pr-6");

    for (const testId of [
      "notes-scroll-viewport",
      "discuss-scroll-viewport",
      "outline-scroll-viewport",
    ]) {
      clickTab(
        container,
        testId === "notes-scroll-viewport"
          ? "Notes"
          : testId === "discuss-scroll-viewport"
            ? "Discuss"
            : "Outline",
      );
      let ancestor = container.querySelector(`[data-testid='${testId}']`)?.parentElement;
      while (ancestor) {
        expect(ancestor.classList.contains("px-6")).toBe(false);
        expect(ancestor.classList.contains("pr-6")).toBe(false);
        if (ancestor === rail) break;
        ancestor = ancestor.parentElement;
      }
    }
  });

  it("switches Notes, Discuss, and Outline in place", () => {
    const container = renderRail();
    expect(
      container.querySelector("[data-testid='notes-panel']")?.getAttribute("data-chromeless"),
    ).toBe("true");

    clickTab(container, "Discuss");
    expect(container.querySelector("[data-testid='chat-panel']")).not.toBeNull();

    clickTab(container, "Outline");
    expect(
      container.querySelector("[data-testid='outline-panel']")?.getAttribute("data-chromeless"),
    ).toBe("true");
  });

  it("uses one sliding underline left-aligned with the active tab label", () => {
    const container = renderRail();
    const tabList = container.querySelector("[aria-label='Reading tools']");
    const indicators = tabList?.querySelectorAll("[data-testid='rail-tab-indicator']");
    const indicator = indicators?.item(0);

    expect(indicators).toHaveLength(1);
    expect(indicator?.className).toContain("left-[var(--active-tab-left)]");
    expect(indicator?.className).toContain("w-3");
    expect(indicator?.className).toContain("transition-[left]");
    expect(indicator?.className).toContain("motion-reduce:transition-none");
    expect(indicator?.className).not.toContain("left-1/2");
    expect(
      Array.from(tabList?.querySelectorAll("button") ?? []).every(
        (tab) => !tab.className.includes("after:"),
      ),
    ).toBe(true);
  });

  it("hides Review and defaults to Notes", () => {
    const container = renderRail();
    const tabList = container.querySelector("[aria-label='Reading tools']");
    const tabs = Array.from(tabList?.querySelectorAll("button") ?? []);

    expect(tabs.map((tab) => tab.textContent)).toEqual(["Notes", "Discuss", "Outline"]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector("[data-testid='notes-panel']")).not.toBeNull();
    expect(container.textContent).not.toContain("Nothing to review yet.");
  });

  it("shows title, chapter, page metadata, and the rail menu slot", () => {
    const container = renderRail();
    expect(container.textContent).toContain("The Power Broker · Part III, Chapter VII");
    expect(container.textContent).toContain("283 / 1164");
    expect(container.querySelector("#reading-rail-menu")).not.toBeNull();
  });

  it("opens the table of contents from the chapter label and navigates", () => {
    const container = renderRail();
    const chapter = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Part III, Chapter VII",
    );

    expect(chapter?.getAttribute("aria-label")).toContain("Open table of contents");
    act(() => chapter?.click());
    const entry = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Chapter One",
    );
    expect(entry).not.toBeUndefined();

    act(() => entry?.click());
    expect(navigateToToc).toHaveBeenCalledWith("chapter-1.xhtml");
    expect(chapter?.getAttribute("aria-expanded")).toBe("false");
  });

  it("does not make the book title a table of contents control", () => {
    const container = renderRail();
    const title = Array.from(container.querySelectorAll("span")).find(
      (span) => span.textContent === "The Power Broker",
    );
    const titleButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("The Power Broker"),
    );

    act(() => title?.click());
    expect(titleButton).toBeUndefined();
    expect(document.body.querySelector("[data-slot='popover-content']")).toBeNull();
  });

  it("does not render a chapter control without a chapter label or table of contents", () => {
    tocEntries.splice(0);
    const withoutToc = renderRail();
    expect(withoutToc.textContent).toContain("Part III, Chapter VII");
    expect(
      Array.from(withoutToc.querySelectorAll("button")).find(
        (button) => button.textContent === "Part III, Chapter VII",
      ),
    ).toBeUndefined();

    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    tocEntries.push({ label: "Chapter One", href: "chapter-1.xhtml" });
    readingLocation.chapterLabel = "";
    const withoutChapter = renderRail();
    expect(withoutChapter.textContent).not.toContain("Chapter VII");
    expect(withoutChapter.querySelector("[aria-label^='Open table of contents']")).toBeNull();
  });

  it("shows a PDF bookmark title in the rail metadata", () => {
    workspace.booksRef.current[0].title = "Designing Data-Intensive Applications";
    workspace.booksRef.current[0].format = "pdf";
    readingLocation.chapterLabel = "Part II: Distributed Data";
    readingLocation.currentPage = 167;
    readingLocation.totalPages = 616;

    const container = renderRail();
    expect(container.textContent).toContain(
      "Designing Data-Intensive Applications · Part II: Distributed Data",
    );
    expect(container.textContent).toContain("167 / 616");
  });
});
