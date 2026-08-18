import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { IDockviewPanelProps } from "dockview-react";
import type { JSONContent } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OutlinePanel,
  OUTLINE_POLL_MS,
  OUTLINE_SAVE_MS,
  WorkspaceOutlinePanel,
} from "../outline-panel";
import { ReadingArtifactsError } from "~/lib/reading-agent/artifacts-client";

const mocks = vi.hoisted(() => ({
  fetchReadingArtifacts: vi.fn(),
  saveReadingOutline: vi.fn(),
  setContent: vi.fn(),
  navigateInCluster: vi.fn(),
  focusBookPanel: vi.fn(),
  editorProps: null as null | {
    content?: string;
    compact?: boolean;
    onUpdate?: (content: JSONContent) => void;
    onBlur?: () => void;
    onNavigateToOutlineIncrement?: (locator: string) => void | Promise<void>;
  },
}));

vi.mock("~/lib/context/workspace-context", () => ({
  useWorkspace: () => ({
    dockviewApi: {
      current: {
        panels: [{ id: "book-book-1", focus: mocks.focusBookPanel }],
      },
    },
    navigateInCluster: mocks.navigateInCluster,
  }),
}));

vi.mock("~/lib/reading-agent/artifacts-client", async () => {
  const actual = await vi.importActual<typeof import("~/lib/reading-agent/artifacts-client")>(
    "~/lib/reading-agent/artifacts-client",
  );
  return {
    ...actual,
    fetchReadingArtifacts: mocks.fetchReadingArtifacts,
    saveReadingOutline: mocks.saveReadingOutline,
  };
});

vi.mock("~/components/tiptap-editor", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  return {
    TiptapEditor: ReactModule.forwardRef(function MockTiptapEditor(
      props: NonNullable<typeof mocks.editorProps>,
      ref: React.ForwardedRef<unknown>,
    ) {
      mocks.editorProps = props;
      ReactModule.useImperativeHandle(ref, () => ({
        appendHighlightReference() {},
        appendContent() {},
        setContent: mocks.setContent,
        getContent: () => ({ type: "doc", content: [] }),
        getTopLevelNodeCount: () => 0,
        replaceContentFrom() {},
      }));
      return (
        <div data-testid="outline-editor" onBlur={props.onBlur}>
          {props.content}
        </div>
      );
    }),
  };
});

vi.mock("~/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="outline-scroll-viewport">{children}</div>
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const outline = {
  bookId: "book-1",
  artifacts: {
    outline: {
      content: "# Chapter 1\n\nSiddhartha leaves home.",
      revisionId: "revision-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    characters: null,
    wiki: null,
  },
};

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function renderPanel(chromeless = false) {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  if (chromeless) {
    act(() =>
      root!.render(<WorkspaceOutlinePanel bookId="book-1" bookTitle="Siddhartha" chromeless />),
    );
    return;
  }
  const props = {
    params: { bookId: "book-1", bookTitle: "Siddhartha" },
    api: {
      isVisible: true,
      onDidVisibilityChange: () => ({ dispose() {} }),
    },
  } as unknown as IDockviewPanelProps<{ bookId: string; bookTitle: string }>;
  act(() => root!.render(<OutlinePanel {...props} />));
}

beforeEach(() => {
  mocks.fetchReadingArtifacts.mockReset();
  mocks.saveReadingOutline.mockReset();
  mocks.setContent.mockReset();
  mocks.navigateInCluster.mockReset();
  mocks.focusBookPanel.mockReset();
  mocks.editorProps = null;
  mocks.navigateInCluster.mockResolvedValue(undefined);
  mocks.saveReadingOutline.mockImplementation(async (bookId: string, content: string) => ({
    bookId,
    artifact: {
      content,
      revisionId: "revision-user",
      updatedAt: "2026-01-01T00:00:01.000Z",
    },
  }));
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.useRealTimers();
});

describe("OutlinePanel", () => {
  it("removes the header, card surface, and panel padding in chromeless mode", async () => {
    mocks.fetchReadingArtifacts.mockResolvedValue({
      bookId: "book-1",
      artifacts: { outline: null, characters: null, wiki: null },
    });
    renderPanel(true);

    expect(container!.textContent).toContain("Loading outline…");
    expect(container!.querySelector("h2")).toBeNull();
    expect(container!.firstElementChild?.className).not.toContain("bg-card");
    expect(container!.textContent).not.toContain("Siddhartha");
    await act(async () => {});

    const emptyState = Array.from(container!.querySelectorAll("p")).find(
      (element) => element.textContent === "No outline yet",
    )?.parentElement;
    expect(emptyState?.className).not.toContain("p-6");
    const scrollContent = container!.querySelector(
      "[data-testid='outline-scroll-viewport']",
    )?.firstElementChild;
    expect(scrollContent?.classList.contains("pr-6")).toBe(true);
    expect(scrollContent?.classList.contains("pl-6")).toBe(false);
  });

  it("mounts an editable outline after a successful fetch", async () => {
    mocks.fetchReadingArtifacts.mockResolvedValue(outline);
    renderPanel();
    expect(container!.textContent).toContain("Loading outline…");
    await act(async () => {});
    expect(container!.querySelector("[data-testid='outline-editor']")?.textContent).toBe(
      "# Chapter 1\n\nSiddhartha leaves home.",
    );
  });

  it("uses compact editor spacing in chromeless mode", async () => {
    mocks.fetchReadingArtifacts.mockResolvedValue(outline);
    renderPanel(true);
    await act(async () => {});

    expect(mocks.editorProps?.compact).toBe(true);
    expect(container!.querySelector("[data-testid='outline-editor']")?.textContent).toContain(
      "Siddhartha leaves home.",
    );
  });

  it("navigates to a linked increment and focuses the book panel", async () => {
    mocks.fetchReadingArtifacts.mockResolvedValue(outline);
    renderPanel(true);
    await act(async () => {});

    await act(async () => {
      await mocks.editorProps!.onNavigateToOutlineIncrement!("epubcfi(/6/4!/4/2/1:0)");
    });

    expect(mocks.navigateInCluster).toHaveBeenCalledWith("book-1", "epubcfi(/6/4!/4/2/1:0)");
    expect(mocks.focusBookPanel).toHaveBeenCalledOnce();
  });

  it("shows a sign-in prompt on 401", async () => {
    mocks.fetchReadingArtifacts.mockRejectedValue(
      new ReadingArtifactsError("auth_required", 401, "Authentication required"),
    );
    renderPanel(true);
    await act(async () => {});
    expect(container!.textContent).toContain("Sign in to view the outline for");
    expect(container!.querySelector("a")?.getAttribute("href")).toBe("/login");
  });

  it("shows a keep-reading empty state when the outline is missing", async () => {
    mocks.fetchReadingArtifacts.mockResolvedValue({
      bookId: "book-1",
      artifacts: { outline: null, characters: null, wiki: null },
    });
    renderPanel(true);
    await act(async () => {});
    expect(container!.textContent).toContain("No outline yet");
    expect(container!.textContent).toContain("Keep reading");
  });

  it("retries a failed fetch from the error state", async () => {
    mocks.fetchReadingArtifacts
      .mockRejectedValueOnce(new ReadingArtifactsError("request_failed", 500, "Failed"))
      .mockResolvedValueOnce(outline);
    renderPanel(true);
    await act(async () => {});
    expect(container!.textContent).toContain("Unable to load the outline.");
    await act(async () => {
      container!.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});
    expect(container!.querySelector("[data-testid='outline-editor']")?.textContent).toContain(
      "Siddhartha leaves home.",
    );
  });

  it("polls while visible without remounting", async () => {
    vi.useFakeTimers();
    mocks.fetchReadingArtifacts.mockResolvedValue(outline);
    renderPanel();
    await act(async () => {});
    expect(mocks.fetchReadingArtifacts).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(OUTLINE_POLL_MS));
    expect(mocks.fetchReadingArtifacts).toHaveBeenCalledTimes(2);
  });

  it("saves edited markdown after the notebook idle cadence", async () => {
    vi.useFakeTimers();
    mocks.fetchReadingArtifacts.mockResolvedValue(outline);
    renderPanel();
    await act(async () => {});

    const edited: JSONContent = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Chapter 1" }] },
        {
          type: "outlineIncrement",
          attrs: { locator: "chapter.xhtml?x=1&y=2", page: "12" },
          content: [
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "New fact." }] }],
                },
              ],
            },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "User note." }] },
      ],
    };
    act(() => mocks.editorProps!.onUpdate!(edited));
    await act(async () => vi.advanceTimersByTimeAsync(OUTLINE_SAVE_MS));

    expect(mocks.saveReadingOutline).toHaveBeenCalledWith(
      "book-1",
      '## Chapter 1\n\n<div data-outline-increment="" data-locator="chapter.xhtml?x=1&amp;y=2" data-page="12">\n\n- New fact.\n\n</div>\n\nUser note.',
    );
  });

  it("flushes an edit on blur", async () => {
    mocks.fetchReadingArtifacts.mockResolvedValue(outline);
    renderPanel();
    await act(async () => {});
    act(() =>
      mocks.editorProps!.onUpdate!({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Blurred edit" }] }],
      }),
    );

    await act(async () => {
      container!
        .querySelector("[data-testid='outline-editor']")!
        .dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(mocks.saveReadingOutline).toHaveBeenCalledWith("book-1", "Blurred edit");
  });

  it("does not overwrite dirty edits with a remote append", async () => {
    const appended = {
      ...outline,
      artifacts: {
        ...outline.artifacts,
        outline: {
          ...outline.artifacts.outline,
          content: "# Chapter 1\n\nSiddhartha leaves home.\n\n- A new dwell fact.",
          revisionId: "revision-2",
        },
      },
    };
    mocks.fetchReadingArtifacts.mockResolvedValueOnce(outline).mockResolvedValue(appended);
    renderPanel();
    await act(async () => {});
    act(() =>
      mocks.editorProps!.onUpdate!({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Unsaved edit" }] }],
      }),
    );

    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(mocks.setContent).not.toHaveBeenCalled();

    await act(async () => mocks.editorProps!.onBlur!());
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(mocks.setContent).toHaveBeenCalledWith(
      "# Chapter 1\n\nSiddhartha leaves home.\n\n- A new dwell fact.",
    );
  });

  it("renders only linked increments with page labels as quiet gutter marks", async () => {
    const { TiptapEditor: ActualTiptapEditor } = await vi.importActual<
      typeof import("~/components/tiptap-editor")
    >("~/components/tiptap-editor");
    const onNavigate = vi.fn();
    const editorContainer = document.body.appendChild(document.createElement("div"));
    const editorRoot = createRoot(editorContainer);

    await act(async () =>
      editorRoot.render(
        <ActualTiptapEditor
          content={
            '<div data-outline-increment="" data-locator="chapter.xhtml#page=12" data-page="12">\n\n- Linked fact.\n\n</div>\n\n<div data-outline-increment="" data-locator="chapter.xhtml#page=13">\n\n- Missing label.\n\n</div>\n\n- Legacy fact.'
          }
          onNavigateToOutlineIncrement={onNavigate}
        />,
      ),
    );
    await act(async () => {});

    const mark = editorContainer.querySelector<HTMLButtonElement>(
      'button[aria-label="Go to page 12"]',
    );
    expect(mark).not.toBeNull();
    expect(mark!.parentElement?.className).toContain("pl-[22px]");
    expect(mark!.parentElement?.className).not.toContain("pl-8");
    expect(mark!.className).toContain("left-0");
    expect(mark!.className).toContain("text-left");
    expect(mark!.className).not.toContain("text-right");
    expect(editorContainer.querySelector('button[aria-label="Go to page 13"]')).toBeNull();
    expect(editorContainer.querySelectorAll("button")).toHaveLength(1);

    await act(async () => mark!.click());
    expect(onNavigate).toHaveBeenCalledWith("chapter.xhtml#page=12");

    act(() => editorRoot.unmount());
    editorContainer.remove();
  });
});
