import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
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

vi.mock("~/lib/context/workspace-context", () => ({ useWorkspace: () => workspace }));
vi.mock("~/components/workspace/panel-components", () => ({
  WorkspaceNotebookPanel: ({ chromeless }: { chromeless?: boolean }) => (
    <div data-testid="notes-panel" data-chromeless={chromeless}>
      Notes panel
    </div>
  ),
}));
vi.mock("~/components/chat/chat-panel", () => ({
  ChatPanel: () => <div data-testid="chat-panel">Chat panel</div>,
}));
vi.mock("~/components/workspace/outline-panel", () => ({
  WorkspaceOutlinePanel: ({ chromeless }: { chromeless?: boolean }) => (
    <div data-testid="outline-panel" data-chromeless={chromeless}>
      Outline panel
    </div>
  ),
}));

import { ReadingRail } from "~/components/reading-shell/reading-rail";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function renderRail() {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(<ReadingRail />));
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
    expect(Array.from(tabList?.querySelectorAll("button") ?? [])).toSatisfyAll(
      (tab) => !tab.className.includes("after:"),
    );
  });

  it("shows the Review empty stub", () => {
    const container = renderRail();
    clickTab(container, "Review");
    expect(container.textContent).toContain("Nothing to review yet.");
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
