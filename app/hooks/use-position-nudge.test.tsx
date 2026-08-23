import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  nudge: null as { cfi: string; updatedAt: number } | null,
  toast: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("~/lib/themis/provider", () => ({
  useAppStore: () => ({
    dispatch: mocks.dispatch,
    readingPositionsSelectors: {
      selectPositionNudge: { useValue: () => mocks.nudge },
    },
  }),
}));

import { usePositionNudge } from "~/hooks/use-position-nudge";
import { checkPositionNudgeRequested } from "~/lib/themis/reading-positions/reading-positions-slice";

let root: Root | null = null;

async function renderNudge(bookId: string, navigateToPosition: (cfi: string) => void) {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);

  function Harness() {
    usePositionNudge({ bookId, enabled: true, navigateToPosition });
    return null;
  }

  await act(async () => root?.render(<Harness />));
}

async function emitPositionSync() {
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent("sync:entity-updated", { detail: { entity: "position" } }),
    );
  });
}

beforeEach(() => {
  mocks.dispatch.mockReset();
  mocks.toast.mockReset();
  mocks.nudge = null;
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("usePositionNudge", () => {
  it("checks after position sync and offers an explicit jump without auto-navigating", async () => {
    const navigateToPosition = vi.fn();
    await renderNudge("passive-toast-book", navigateToPosition);

    expect(mocks.dispatch).toHaveBeenCalledWith(checkPositionNudgeRequested("passive-toast-book"));
    expect(mocks.toast).not.toHaveBeenCalled();

    mocks.nudge = { cfi: "page:12", updatedAt: 100 };
    await emitPositionSync();

    expect(mocks.dispatch).toHaveBeenCalledTimes(2);
    expect(mocks.toast).toHaveBeenCalledWith("You were further along on another device", {
      action: expect.objectContaining({ label: "Go to furthest position" }),
    });
    expect(navigateToPosition).not.toHaveBeenCalled();

    const options = mocks.toast.mock.calls[0]?.[1] as { action: { onClick: () => void } };
    options.action.onClick();
    expect(navigateToPosition).toHaveBeenCalledWith("page:12");
  });

  it("shows at most once for each remote updatedAt", async () => {
    await renderNudge("dedupe-toast-book", vi.fn());

    mocks.nudge = { cfi: "page:12", updatedAt: 200 };
    await emitPositionSync();
    await emitPositionSync();
    expect(mocks.toast).toHaveBeenCalledTimes(1);

    mocks.nudge = { cfi: "page:13", updatedAt: 201 };
    await emitPositionSync();
    expect(mocks.toast).toHaveBeenCalledTimes(2);
  });
});
