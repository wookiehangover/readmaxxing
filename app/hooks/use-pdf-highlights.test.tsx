import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePdfHighlights, type PdfSelectionPopover } from "~/hooks/use-pdf-highlights";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
}));

vi.mock("~/hooks/use-sync-listener", () => ({ useSyncListener: () => 0 }));
vi.mock("~/lib/themis/provider", () => ({
  useAppStore: () => ({
    dispatch: mocks.dispatch,
    annotationsSelectors: { selectHighlightsByBook: { useValue: () => [] } },
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let latest: ReturnType<typeof usePdfHighlights> | null = null;

beforeEach(() => {
  mocks.dispatch.mockReset().mockImplementation((action) => {
    if (action.type === "annotations/addHighlightRequested") action.payload[1]?.(action.payload[0]);
    return action;
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  latest = null;
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

function renderHook(containerRef: React.RefObject<HTMLDivElement | null>, onSelection: () => void) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);

  function Harness() {
    const value = usePdfHighlights({ bookId: "book-1", containerRef, theme: "light" });
    latest = value;
    useEffect(() => {
      if (value.selectionPopover) onSelection();
    }, [value.selectionPopover]);
    return null;
  }

  act(() => root?.render(<Harness />));
}

function selectText(container: HTMLElement) {
  const page = document.createElement("div");
  page.className = "page";
  page.dataset.pageNumber = "2";
  const textLayer = document.createElement("div");
  textLayer.className = "textLayer";
  const span = document.createElement("span");
  span.textContent = "  selected text remains";
  textLayer.appendChild(span);
  page.appendChild(textLayer);
  container.appendChild(page);

  const range = document.createRange();
  range.setStart(span.firstChild!, 0);
  range.setEnd(span.firstChild!, 15);
  Object.defineProperty(range, "getBoundingClientRect", {
    value: () => ({ left: 20, bottom: 60, width: 100 }),
  });
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

describe("usePdfHighlights touch selection", () => {
  it("opens one saveable popover for pointer completion and ignores synthesized mouseup", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    const onSelection = vi.fn();
    renderHook({ current: container }, onSelection);
    selectText(container);

    act(() => {
      container.dispatchEvent(new Event("pointerup", { bubbles: true }));
      container.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    expect(onSelection).toHaveBeenCalledOnce();
    expect(latest?.selectionPopover).toEqual({
      position: { x: 70, y: 60 },
      text: "selected text",
      pageNumber: 2,
      textOffset: 2,
      textLength: 13,
    } satisfies PdfSelectionPopover);

    await act(async () => {
      await latest?.saveHighlight();
    });
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "annotations/addHighlightRequested",
        payload: [
          expect.objectContaining({
            bookId: "book-1",
            cfiRange: "pdf:page:2:offset:2:len:13",
            text: "selected text",
          }),
          expect.any(Function),
          expect.any(Function),
        ],
      }),
    );
    expect(latest?.selectionPopover).toBeNull();
  });
});
