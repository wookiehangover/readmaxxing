import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ReadingArtifactRow,
  ReadingIngestUnitRow,
} from "~/lib/database/reading-artifact/reading-artifact";
import {
  dispatchReadingIngestUnit,
  drainReadingIngestQueue,
  ORPHANED_READING_AGENT_ERROR,
  readingConversationId,
  reclaimOrphanedReadingAgentLease,
  resetLocalReadingIngestSweep,
  shouldStartLocalReadingIngestSweep,
  startLocalReadingIngestSweep,
  sweepReadingIngestQueues,
} from "../dispatch.server";
import { DEFAULT_DEBUG_READING_AGENT_MODEL, setSelectedDebugModel } from "../debug-model.server";

const unit: ReadingIngestUnitRow = {
  id: "unit-1",
  userId: "user-1",
  bookId: "book-1",
  fingerprint: "fingerprint-1",
  unitKind: "epub-spine",
  locator: "chapter.xhtml",
  chapterLabel: "Chapter 1",
  text: "A newly read chapter page.",
  status: "pending",
  firstSeenAt: new Date("2026-01-01T00:00:00Z"),
  lastSeenAt: new Date("2026-01-01T00:00:00Z"),
  attemptCount: 0,
  claimedAt: null,
  nextAttemptAt: new Date("2026-01-01T00:00:00Z"),
  processedAt: null,
  error: null,
};

const claimed = { ...unit, status: "processing" as const };
const leased = {
  unit: claimed,
  lease: {
    userId: "user-1",
    unitId: "unit-1",
    bookId: "book-1",
    expiresAt: new Date("2026-01-01T00:05:00Z"),
  },
};
const outline: ReadingArtifactRow = {
  userId: "user-1",
  bookId: "book-1",
  kind: "outline",
  content: "## Chapter 1\n- Existing event.\n\n## Chapter 2\n- Later event.",
  revisionId: "revision-1",
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};
const characters: ReadingArtifactRow = {
  ...outline,
  kind: "characters",
  content: "Existing cast.",
};
const wiki: ReadingArtifactRow = { ...outline, kind: "wiki", content: "Existing story." };
const aiSdkUsage = {
  input: 100,
  output: 20,
  cacheRead: 5,
  cacheWrite: 0,
  totalTokens: 125,
  costTotal: 0,
  model: "openai/gpt-5.5",
  source: "ai-sdk" as const,
};

const claimLease = vi.fn();
const complete = vi.fn();
const getCurrent = vi.fn();
const release = vi.fn();
const callIncrement = vi.fn();
const getNextDue = vi.fn();
const dispatch = vi.fn();
const listUserIds = vi.fn();
const reclaim = vi.fn();
const drain = vi.fn();
const getLease = vi.fn();
const getActiveHost = vi.fn();
const stopUnit = vi.fn();

beforeEach(() => {
  setSelectedDebugModel(DEFAULT_DEBUG_READING_AGENT_MODEL);
  claimLease.mockReset().mockResolvedValue(leased);
  complete.mockReset().mockResolvedValue(1);
  getCurrent.mockReset().mockResolvedValue([outline, characters, wiki]);
  release.mockReset().mockResolvedValue(undefined);
  getNextDue.mockReset().mockResolvedValue(null);
  dispatch.mockReset().mockResolvedValue("done");
  listUserIds.mockReset().mockResolvedValue([]);
  reclaim.mockReset().mockResolvedValue(0);
  drain.mockReset().mockResolvedValue(undefined);
  getLease.mockReset().mockResolvedValue(null);
  getActiveHost.mockReset().mockReturnValue(false);
  stopUnit.mockReset().mockResolvedValue(true);
  callIncrement.mockReset().mockResolvedValue({
    bullets: ["New event."],
    usage: aiSdkUsage,
  });
});

afterEach(() => {
  setSelectedDebugModel(DEFAULT_DEBUG_READING_AGENT_MODEL);
});

const options = () => ({
  dependencies: { claimLease, complete, getCurrent, release, callIncrement },
});

describe("reading ingest dispatch", () => {
  it("merges the page bullets into the outline and persists only the outline", async () => {
    setSelectedDebugModel("openai/gpt-5.5");
    await expect(dispatchReadingIngestUnit(unit, options())).resolves.toBe("done");

    expect(complete).toHaveBeenCalledWith(
      leased,
      [
        {
          kind: "outline",
          content: "## Chapter 1\n- Existing event.\n- New event.\n\n## Chapter 2\n- Later event.",
          summary: "Added this page's outline increment.",
        },
      ],
      expect.objectContaining({ totalTokens: 125, source: "ai-sdk" }),
    );
    expect(release).not.toHaveBeenCalled();
    expect(callIncrement).toHaveBeenCalledWith({
      model: "openai/gpt-5.5",
      page: "A newly read chapter page.",
      chapterLabel: "Chapter 1",
      existingBullets: ["Existing event."],
    });
  });

  it("completes without writing an artifact when the page adds no bullets", async () => {
    callIncrement.mockResolvedValue({ bullets: [], usage: aiSdkUsage });

    await expect(dispatchReadingIngestUnit(unit, options())).resolves.toBe("done");

    expect(complete).toHaveBeenCalledWith(leased, [], aiSdkUsage);
  });

  it("releases a failed Gateway call for retry without marking the unit done", async () => {
    callIncrement.mockRejectedValue(new Error("Gateway unavailable"));

    await expect(dispatchReadingIngestUnit(unit, options())).resolves.toBe("failed");

    expect(complete).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(leased, "Gateway unavailable", {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      costTotal: 0,
      model: DEFAULT_DEBUG_READING_AGENT_MODEL,
      source: "ai-sdk",
    });
  });

  it("cleans up without duplicating usage when a settled call loses its lease fence", async () => {
    complete.mockResolvedValue(null);

    await expect(dispatchReadingIngestUnit(unit, options())).resolves.toBe("failed");

    expect(complete).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith(
      leased,
      "Reading agent completion lease is no longer live",
    );
  });

  it("does not record usage when the Gateway client was never called", async () => {
    getCurrent.mockRejectedValue(new Error("Artifact read failed"));

    await expect(dispatchReadingIngestUnit(unit, options())).resolves.toBe("failed");

    expect(callIncrement).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(leased, "Artifact read failed", undefined);
  });

  it("does not dispatch when the user already has a lease", async () => {
    claimLease.mockResolvedValue(null);

    await expect(dispatchReadingIngestUnit(unit, options())).resolves.toBe("already-leased");

    expect(callIncrement).not.toHaveBeenCalled();
  });

  it("does not pass Flue host, secret, conversation, or artifact inputs", async () => {
    await expect(dispatchReadingIngestUnit(unit, options())).resolves.toBe("done");

    const call = callIncrement.mock.calls[0]?.[0];
    expect(call).not.toHaveProperty("secret");
    expect(call).not.toHaveProperty("conversationId");
    expect(call).not.toHaveProperty("artifacts");
    expect(complete).toHaveBeenCalledOnce();
  });

  it("uses a stable, opaque conversation id per ingest unit", () => {
    expect(readingConversationId("user-1", "book-1", "unit-1")).toBe(
      readingConversationId("user-1", "book-1", "unit-1"),
    );
    expect(readingConversationId("user-1", "book-1", "unit-1")).not.toBe(
      readingConversationId("user-1", "book-1", "unit-2"),
    );
    expect(readingConversationId("user-1", "book-1", "unit-1")).not.toBe(
      readingConversationId("user-1", "book-2", "unit-1"),
    );
  });

  it("reclaims a live lease when its in-app host is missing", async () => {
    getLease.mockResolvedValue(leased.lease);

    await expect(
      reclaimOrphanedReadingAgentLease("user-1", {
        dependencies: { getLease, getActiveHost, stopUnit },
      }),
    ).resolves.toBe(true);

    expect(getActiveHost).toHaveBeenCalledWith(readingConversationId("user-1", "book-1", "unit-1"));
    expect(stopUnit).toHaveBeenCalledWith("user-1", "unit-1", ORPHANED_READING_AGENT_ERROR);
  });

  it("leaves a live lease running when its in-app host is active", async () => {
    getLease.mockResolvedValue(leased.lease);
    getActiveHost.mockReturnValue(true);

    await expect(
      reclaimOrphanedReadingAgentLease("user-1", {
        dependencies: { getLease, getActiveHost, stopUnit },
      }),
    ).resolves.toBe(false);

    expect(stopUnit).not.toHaveBeenCalled();
  });

  it("does nothing when the queue is empty or a user lease is busy", async () => {
    await expect(
      drainReadingIngestQueue("user-1", {
        dependencies: { reclaim, getNextDue, dispatch },
      }),
    ).resolves.toBeUndefined();

    expect(reclaim).toHaveBeenCalledWith("user-1");
    expect(getNextDue).toHaveBeenCalledWith("user-1");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("reclaims expired leases before inspecting the due queue", async () => {
    getNextDue.mockResolvedValue(unit);

    await drainReadingIngestQueue("user-1", {
      maxUnits: 1,
      dependencies: { reclaim, getNextDue, dispatch },
    });

    expect(reclaim).toHaveBeenCalledWith("user-1");
    expect(getNextDue).toHaveBeenCalledWith("user-1");
    expect(reclaim.mock.invocationCallOrder[0]).toBeLessThan(
      getNextDue.mock.invocationCallOrder[0],
    );
  });

  it("starts the next due unit only after the current dispatch settles", async () => {
    const second = { ...unit, id: "unit-2", fingerprint: "fingerprint-2" };
    let settleFirst: (() => void) | undefined;
    getNextDue
      .mockResolvedValueOnce(unit)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(null);
    dispatch
      .mockImplementationOnce(
        () =>
          new Promise<"done">((resolve) => {
            settleFirst = () => resolve("done");
          }),
      )
      .mockResolvedValueOnce("done");

    const drain = drainReadingIngestQueue("user-1", {
      dependencies: { reclaim, getNextDue, dispatch },
    });
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    expect(getNextDue).toHaveBeenCalledTimes(1);

    settleFirst?.();
    await drain;

    expect(dispatch).toHaveBeenNthCalledWith(2, second);
    expect(getNextDue).toHaveBeenCalledTimes(3);
  });

  it("limits a cron drain to one due unit", async () => {
    getNextDue.mockResolvedValue(unit);

    await drainReadingIngestQueue("user-1", {
      maxUnits: 1,
      dependencies: { reclaim, getNextDue, dispatch },
    });

    expect(getNextDue).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("reclaims each eligible user before starting one due unit", async () => {
    listUserIds.mockResolvedValue(["user-1", "user-2"]);

    await expect(
      sweepReadingIngestQueues({
        dependencies: { listUserIds, reclaim, drain },
      }),
    ).resolves.toBe(2);

    expect(reclaim).toHaveBeenCalledTimes(2);
    expect(drain).toHaveBeenCalledWith("user-1", expect.objectContaining({ maxUnits: 1 }));
    expect(reclaim.mock.invocationCallOrder.at(-1)).toBeLessThan(drain.mock.invocationCallOrder[0]);
  });

  it("drains the queue without propagating a leftover remote URL", async () => {
    getNextDue.mockResolvedValueOnce(unit).mockResolvedValueOnce(null);

    await drainReadingIngestQueue("user-1", {
      dependencies: { reclaim, getNextDue, dispatch },
    });

    expect(reclaim).toHaveBeenCalledWith("user-1");
    expect(dispatch).toHaveBeenCalledWith(unit);
  });

  it("sweeps the database without propagating a leftover remote URL", async () => {
    listUserIds.mockResolvedValue(["user-1"]);

    await expect(
      sweepReadingIngestQueues({
        dependencies: { listUserIds, reclaim, drain },
      }),
    ).resolves.toBe(1);

    expect(reclaim).toHaveBeenCalledWith("user-1");
    expect(drain).toHaveBeenCalledWith("user-1", expect.objectContaining({ maxUnits: 1 }));
  });
});

describe("local reading ingest sweep", () => {
  const readyEnv = {
    isDev: true,
    nodeEnv: "development",
    vitest: undefined,
    databaseUrl: "postgres://configured",
    gatewayApiKey: "gateway-key",
  };

  afterEach(() => {
    resetLocalReadingIngestSweep();
  });

  it("does not start without a database or Gateway credential, or outside development", () => {
    expect(shouldStartLocalReadingIngestSweep({ ...readyEnv, isDev: false })).toBe(false);
    expect(shouldStartLocalReadingIngestSweep({ ...readyEnv, nodeEnv: "test" })).toBe(false);
    expect(shouldStartLocalReadingIngestSweep({ ...readyEnv, vitest: "true" })).toBe(false);
    expect(shouldStartLocalReadingIngestSweep({ ...readyEnv, databaseUrl: "" })).toBe(false);
    expect(shouldStartLocalReadingIngestSweep({ ...readyEnv, gatewayApiKey: "" })).toBe(false);
    expect(shouldStartLocalReadingIngestSweep(readyEnv)).toBe(true);
  });

  it("starts once, sweeps immediately, and uses a 60s interval", () => {
    const sweep = vi.fn().mockResolvedValue(1);
    const setIntervalFn = vi.fn().mockReturnValue({ unref: vi.fn() });

    expect(startLocalReadingIngestSweep({ env: readyEnv, sweep, setIntervalFn })).toBe(true);
    expect(startLocalReadingIngestSweep({ env: readyEnv, sweep, setIntervalFn })).toBe(false);

    expect(sweep).toHaveBeenCalledOnce();
    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 60_000);
  });
});
