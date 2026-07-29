import { describe, expect, it, vi } from "vitest";
import { openBookInWorkspace } from "~/routes/workspace-library";
import type { BookMeta } from "~/lib/stores/book-store";
import type { WorkspaceContextValue } from "~/lib/context/workspace-context";

const book: BookMeta = {
  id: "book-1",
  title: "Test Book",
  author: "Test Author",
  coverImage: null,
  format: "epub",
};

describe("openBookInWorkspace", () => {
  it("navigates to the workspace and waits for Dockview before opening the book", () => {
    const navigate = vi.fn();
    const openBook = vi.fn();
    const frames: FrameRequestCallback[] = [];
    const scheduleFrame = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const workspace = {
      dockviewApi: { current: null },
      openBookRef: { current: openBook },
    } as Pick<WorkspaceContextValue, "dockviewApi" | "openBookRef">;

    openBookInWorkspace(book, navigate, workspace, { scheduleFrame });

    expect(navigate).toHaveBeenCalledWith("/");
    frames.shift()?.(0);
    expect(openBook).not.toHaveBeenCalled();

    workspace.dockviewApi.current = {} as WorkspaceContextValue["dockviewApi"]["current"];
    frames.shift()?.(1);
    expect(openBook).toHaveBeenCalledWith(book);
  });

  it("stops waiting when the pending open is cancelled", () => {
    const controller = new AbortController();
    const frames: FrameRequestCallback[] = [];
    const scheduleFrame = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const workspace = {
      dockviewApi: { current: null },
      openBookRef: { current: vi.fn() },
    } as Pick<WorkspaceContextValue, "dockviewApi" | "openBookRef">;

    openBookInWorkspace(book, vi.fn(), workspace, {
      signal: controller.signal,
      scheduleFrame,
    });
    controller.abort();
    frames.shift()?.(0);

    expect(scheduleFrame).toHaveBeenCalledTimes(1);
    expect(workspace.openBookRef.current).not.toHaveBeenCalled();
  });

  it("stops waiting after the maximum number of frames", () => {
    const frames: FrameRequestCallback[] = [];
    const scheduleFrame = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const workspace = {
      dockviewApi: { current: null },
      openBookRef: { current: vi.fn() },
    } as Pick<WorkspaceContextValue, "dockviewApi" | "openBookRef">;

    openBookInWorkspace(book, vi.fn(), workspace, { scheduleFrame, maxFrames: 2 });
    frames.shift()?.(0);
    frames.shift()?.(1);

    expect(scheduleFrame).toHaveBeenCalledTimes(2);
    expect(frames).toHaveLength(0);
    expect(workspace.openBookRef.current).not.toHaveBeenCalled();
  });
});
