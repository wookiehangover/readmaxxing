import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readingLocation = {
  chapterLabel: "Part III, Chapter VII",
  currentPage: 283,
  totalPages: 1164,
};

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
}));

vi.mock("~/lib/context/workspace-context", () => ({ useWorkspace: () => workspace }));
vi.mock("~/components/workspace/panel-components", () => ({
  WorkspaceNotebookPanel: () => <div data-testid="notes-panel">Notes panel</div>,
}));
vi.mock("~/components/chat/chat-panel", () => ({
  ChatPanel: () => <div data-testid="chat-panel">Chat panel</div>,
}));
vi.mock("~/components/workspace/outline-panel", () => ({
  WorkspaceOutlinePanel: () => <div data-testid="outline-panel">Outline panel</div>,
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
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("ReadingRail", () => {
  it("switches Notes, Chat, and Outline in place", () => {
    const container = renderRail();
    expect(container.querySelector("[data-testid='notes-panel']")).not.toBeNull();

    clickTab(container, "Chat");
    expect(container.querySelector("[data-testid='chat-panel']")).not.toBeNull();

    clickTab(container, "Outline");
    expect(container.querySelector("[data-testid='outline-panel']")).not.toBeNull();
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
