import { beforeEach, describe, expect, it, vi } from "vitest";

const toastMocks = vi.hoisted(() => ({
  show: vi.fn(),
  loading: vi.fn(() => "checking-toast"),
  dismiss: vi.fn(),
  success: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(toastMocks.show, {
    loading: toastMocks.loading,
    dismiss: toastMocks.dismiss,
    success: toastMocks.success,
  }),
}));

import { syncToFurthestPosition } from "~/hooks/use-sync-to-furthest-position";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("syncToFurthestPosition", () => {
  it("pulls before resolving and jumps to further content regardless of timestamp", async () => {
    const pullChanges = vi.fn().mockResolvedValue(undefined);
    const getRemotePosition = vi.fn().mockResolvedValue({
      cfi: "page:12",
      updatedAt: 1,
    });
    const navigateToPosition = vi.fn();

    const outcome = await syncToFurthestPosition({
      bookId: "book-1",
      getCurrentPosition: () => "page:2",
      navigateToPosition,
      pullChanges,
      isOnline: true,
      getRemotePosition,
    });

    expect(outcome).toBe("jumped");
    expect(pullChanges).toHaveBeenCalledOnce();
    expect(pullChanges.mock.invocationCallOrder[0]).toBeLessThan(
      getRemotePosition.mock.invocationCallOrder[0]!,
    );
    expect(navigateToPosition).toHaveBeenCalledWith("page:12");
    expect(toastMocks.dismiss).toHaveBeenCalledWith("checking-toast");
    expect(toastMocks.success).toHaveBeenCalledWith("Synced to furthest page.");
  });

  it("reports already current without navigating", async () => {
    const navigateToPosition = vi.fn();

    const outcome = await syncToFurthestPosition({
      bookId: "book-1",
      getCurrentPosition: () => "page:12",
      navigateToPosition,
      pullChanges: vi.fn().mockResolvedValue(undefined),
      isOnline: true,
      getRemotePosition: vi.fn().mockResolvedValue({ cfi: "page:2", updatedAt: 2 }),
    });

    expect(outcome).toBe("already-current");
    expect(navigateToPosition).not.toHaveBeenCalled();
    expect(toastMocks.show).toHaveBeenCalledWith("You're already at the furthest page.");
    expect(toastMocks.dismiss).toHaveBeenCalledWith("checking-toast");
  });

  it("uses the cached remote position when the pull fails", async () => {
    const navigateToPosition = vi.fn();

    const outcome = await syncToFurthestPosition({
      bookId: "book-1",
      getCurrentPosition: () => "page:2",
      navigateToPosition,
      pullChanges: vi.fn().mockRejectedValue(new Error("offline")),
      isOnline: true,
      getRemotePosition: vi.fn().mockResolvedValue({ cfi: "page:12", updatedAt: 1 }),
    });

    expect(outcome).toBe("jumped");
    expect(navigateToPosition).toHaveBeenCalledWith("page:12");
    expect(toastMocks.success).toHaveBeenCalledWith("Synced to furthest cached page.");
    expect(toastMocks.dismiss).toHaveBeenCalledWith("checking-toast");
  });
});
