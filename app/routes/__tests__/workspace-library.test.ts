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
  it("navigates to the workspace and hands the book to the pending-open handler", () => {
    const navigate = vi.fn();
    const openBook = vi.fn();
    const frames: FrameRequestCallback[] = [];
    const scheduleFrame = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const workspace = {
      openBookRef: { current: openBook },
    } as Pick<WorkspaceContextValue, "openBookRef">;

    openBookInWorkspace(book, navigate, workspace, { scheduleFrame });

    expect(navigate).toHaveBeenCalledWith("/");
    expect(openBook).not.toHaveBeenCalled();
    frames.shift()?.(0);
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
      openBookRef: { current: vi.fn() },
    } as Pick<WorkspaceContextValue, "openBookRef">;

    openBookInWorkspace(book, vi.fn(), workspace, {
      signal: controller.signal,
      scheduleFrame,
    });
    controller.abort();
    frames.shift()?.(0);

    expect(scheduleFrame).toHaveBeenCalledTimes(1);
    expect(workspace.openBookRef.current).not.toHaveBeenCalled();
  });

  it("does not navigate when the pending open is already cancelled", () => {
    const controller = new AbortController();
    controller.abort();
    const navigate = vi.fn();
    const scheduleFrame = vi.fn();
    const workspace = {
      openBookRef: { current: vi.fn() },
    } as Pick<WorkspaceContextValue, "openBookRef">;

    openBookInWorkspace(book, navigate, workspace, {
      signal: controller.signal,
      scheduleFrame,
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(scheduleFrame).not.toHaveBeenCalled();
    expect(workspace.openBookRef.current).not.toHaveBeenCalled();
  });

  it("does not hand off after the user leaves the workspace route", () => {
    const frames: FrameRequestCallback[] = [];
    const scheduleFrame = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const workspace = {
      openBookRef: { current: vi.fn() },
    } as Pick<WorkspaceContextValue, "openBookRef">;

    openBookInWorkspace(book, vi.fn(), workspace, {
      scheduleFrame,
      isWorkspaceActive: () => false,
    });
    frames.shift()?.(0);

    expect(scheduleFrame).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(0);
    expect(workspace.openBookRef.current).not.toHaveBeenCalled();
  });
});
