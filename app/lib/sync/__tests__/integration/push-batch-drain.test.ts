import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clear, createStore } from "idb-keyval";
import { clearSyncedChanges, getUnsyncedChanges, recordChange } from "../../change-log";
import { PUSH_BATCH_SIZE, makeSyncEngine } from "../../sync-engine";
import type { SyncPushRequest } from "../../types";

// Avoid accidentally calling the real Vercel Blob client during
// uploadPendingFiles (fire-and-forget from push).
vi.mock("@vercel/blob/client", () => ({
  upload: vi.fn(async () => ({ url: "blob://unused" })),
}));

// Store names must mirror production getters in app/lib/sync/stores.ts and
// app/lib/sync/change-log.ts so the test harness clears the same IDB rows.
const changeLogStore = createStore("ebook-reader-changelog", "changes");
const bookStore = createStore("ebook-reader-db", "books");

beforeEach(async () => {
  await Promise.all([clear(changeLogStore), clear(bookStore)]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Scenario 1: push batch ≤ 50 drains across multiple calls.
describe("integration: push batch drain", () => {
  it("drains >50 queued changes via follow-up pushes with every batch ≤ PUSH_BATCH_SIZE", async () => {
    const TOTAL = 120;
    for (let i = 0; i < TOTAL; i++) {
      await recordChange({
        entity: "position",
        entityId: `book-${i.toString().padStart(3, "0")}`,
        operation: "put",
        data: { cfi: `cfi-${i}`, updatedAt: i },
        timestamp: i,
      });
    }

    const batchSizes: number[] = [];
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as SyncPushRequest;
      batchSizes.push(body.changes.length);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          accepted: body.changes.map((c) => ({ id: c.id })),
          rejected: [],
          serverTimestamp: new Date().toISOString(),
        }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const engine = makeSyncEngine({ userId: "user-test" });
    await engine.pushChanges();

    // Follow-ups are scheduled via queueMicrotask; poll until drained.
    for (let i = 0; i < 100; i++) {
      const remaining = await getUnsyncedChanges();
      if (remaining.length === 0) break;
      await new Promise((r) => setTimeout(r, 5));
    }

    expect(fetchMock).toHaveBeenCalledTimes(Math.ceil(TOTAL / PUSH_BATCH_SIZE));
    expect(batchSizes.length).toBeGreaterThanOrEqual(2);
    for (const size of batchSizes) expect(size).toBeLessThanOrEqual(PUSH_BATCH_SIZE);
    expect(batchSizes.reduce((a, b) => a + b, 0)).toBe(TOTAL);
    expect(await getUnsyncedChanges()).toHaveLength(0);

    // Sweep cleared entries from the change log so cross-test state stays tidy
    // even if vitest isolate is off.
    await clearSyncedChanges();
  });
});
