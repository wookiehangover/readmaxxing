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
import { ReadingScribeCallError } from "../flue-client.server";

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
const wiki: ReadingArtifactRow = {
  userId: "user-1",
  bookId: "book-1",
  kind: "wiki",
  content: "Existing story.",
  revisionId: "revision-1",
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};
const flueUsage = {
  input: 100,
  output: 20,
  cacheRead: 5,
  cacheWrite: 0,
  totalTokens: 125,
  costTotal: 0.001,
  model: "anthropic/claude-sonnet-4-6",
  source: "flue" as const,
};

const claimLease = vi.fn();
const complete = vi.fn();
const getCurrent = vi.fn();
const release = vi.fn();
const callAgent = vi.fn();
const getNextDue = vi.fn();
const dispatch = vi.fn();
const listUserIds = vi.fn();
const reclaim = vi.fn();
const drain = vi.fn();
const getLease = vi.fn();
const getActiveHost = vi.fn();
const stopUnit = vi.fn();
const disposeHost = vi.fn();
const originalReadingAgentUrl = process.env.READING_AGENT_URL;

beforeEach(() => {
  process.env.READING_AGENT_URL = "http://localhost:5174/agents/reading-scribe";
  claimLease.mockReset().mockResolvedValue(leased);
  complete.mockReset().mockResolvedValue(1);
  getCurrent.mockReset().mockResolvedValue([wiki]);
  release.mockReset().mockResolvedValue(undefined);
  getNextDue.mockReset().mockResolvedValue(null);
  dispatch.mockReset().mockResolvedValue("done");
  listUserIds.mockReset().mockResolvedValue([]);
  reclaim.mockReset().mockResolvedValue(0);
  drain.mockReset().mockResolvedValue(undefined);
  getLease.mockReset().mockResolvedValue(null);
  getActiveHost.mockReset().mockReturnValue(false);
  stopUnit.mockReset().mockResolvedValue(true);
  disposeHost.mockReset().mockResolvedValue(true);
  callAgent.mockReset().mockResolvedValue({
    artifacts: {
      outline: { status: "unchanged", body: "", summary: "No outline change." },
      characters: { status: "unchanged", body: "", summary: "No character change." },
      wiki: { status: "updated", body: "Expanded story.", summary: "Added the new scene." },
    },
    usage: flueUsage,
  });
});

afterEach(() => {
  if (originalReadingAgentUrl == null) delete process.env.READING_AGENT_URL;
  else process.env.READING_AGENT_URL = originalReadingAgentUrl;
});

const options = () => ({
  agentSecret: "test-secret",
  dependencies: { claimLease, complete, getCurrent, release, callAgent, disposeHost },
});

describe("reading ingest dispatch", () => {
  it("persists only a changed wiki edit and completes the unit", async () => {
    await expect(dispatchReadingIngestUnit(unit, options())).resolves.toBe("done");

    expect(complete).toHaveBeenCalledWith(
      leased,
      [{ kind: "wiki", content: "Expanded story.", summary: "Added the new scene." }],
      expect.objectContaining({ totalTokens: 125, source: "flue" }),
    );
    expect(release).not.toHaveBeenCalled();
    expect(callAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        secret: "test-secret",
        artifacts: { outline: "", characters: "", wiki: "Existing story." },
        retainHost: true,
      }),
    );
  });

  it("keeps the host registered until the unit lease is completed", async () => {
    complete.mockImplementation(async () => {
      expect(disposeHost).not.toHaveBeenCalled();
      return 1;
    });

    await expect(dispatchReadingIngestUnit(unit, options())).resolves.toBe("done");

    expect(disposeHost).toHaveBeenCalledWith(readingConversationId("user-1", "book-1"));
    expect(complete.mock.invocationCallOrder[0]).toBeLessThan(
      disposeHost.mock.invocationCallOrder[0],
    );
  });

  it("releases a failed Flue call for retry without marking the unit done", async () => {
    callAgent.mockRejectedValue(new Error("Flue unavailable"));

    await expect(dispatchReadingIngestUnit(unit, options())).resolves.toBe("failed");

    expect(complete).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(leased, "Flue unavailable", {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      costTotal: 0,
      model: null,
      source: "unknown",
    });
    expect(release.mock.invocationCallOrder[0]).toBeLessThan(
      disposeHost.mock.invocationCallOrder[0],
    );
  });

  it("cleans up without duplicating usage when a settled call loses its lease fence", async () => {
    complete.mockResolvedValue(null);

    await expect(dispatchReadingIngestUnit(unit, options())).resolves.toBe("failed");

    expect(complete).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith(
      leased,
      "Reading agent completion lease is no longer live",
    );
    expect(release.mock.invocationCallOrder[0]).toBeLessThan(
      disposeHost.mock.invocationCallOrder[0],
    );
  });

  it("passes preserved usage from an invalid reply to failure settlement", async () => {
    callAgent.mockRejectedValue(new ReadingScribeCallError("Invalid reply", flueUsage));

    await expect(dispatchReadingIngestUnit(unit, options())).resolves.toBe("failed");

    expect(release).toHaveBeenCalledWith(leased, "Invalid reply", flueUsage);
  });

  it("does not record usage when Flue was never called", async () => {
    getCurrent.mockRejectedValue(new Error("Artifact read failed"));

    await expect(dispatchReadingIngestUnit(unit, options())).resolves.toBe("failed");

    expect(callAgent).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(leased, "Artifact read failed", undefined);
  });

  it("does not dispatch when the user already has a lease", async () => {
    claimLease.mockResolvedValue(null);

    await expect(dispatchReadingIngestUnit(unit, options())).resolves.toBe("already-leased");

    expect(callAgent).not.toHaveBeenCalled();
  });

  it("dispatches through the in-app host when a leftover remote URL is configured", async () => {
    await expect(
      dispatchReadingIngestUnit(unit, {
        agentSecret: "test-secret",
        dependencies: options().dependencies,
      }),
    ).resolves.toBe("done");

    expect(callAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: readingConversationId("user-1", "book-1"),
      }),
    );
    expect(callAgent.mock.calls[0]?.[0]).not.toHaveProperty("url");
    expect(complete).toHaveBeenCalledOnce();
  });

  it("leaves the unit pending when the agent secret is not configured", async () => {
    await expect(
      dispatchReadingIngestUnit(unit, {
        agentSecret: "",
        dependencies: options().dependencies,
      }),
    ).resolves.toBe("not-configured");

    expect(claimLease).not.toHaveBeenCalled();
  });

  it("uses a stable, opaque conversation id per user and book", () => {
    expect(readingConversationId("user-1", "book-1")).toBe(
      readingConversationId("user-1", "book-1"),
    );
    expect(readingConversationId("user-1", "book-1")).not.toBe(
      readingConversationId("user-1", "book-2"),
    );
  });

  it("reclaims a live lease when its in-app host is missing", async () => {
    getLease.mockResolvedValue(leased.lease);

    await expect(
      reclaimOrphanedReadingAgentLease("user-1", {
        dependencies: { getLease, getActiveHost, stopUnit },
      }),
    ).resolves.toBe(true);

    expect(getActiveHost).toHaveBeenCalledWith(readingConversationId("user-1", "book-1"));
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
        agentSecret: "test-secret",
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
      agentSecret: "test-secret",
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
      agentSecret: "test-secret",
      dependencies: { reclaim, getNextDue, dispatch },
    });
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    expect(getNextDue).toHaveBeenCalledTimes(1);

    settleFirst?.();
    await drain;

    expect(dispatch).toHaveBeenNthCalledWith(
      2,
      second,
      expect.objectContaining({ agentSecret: "test-secret" }),
    );
    expect(getNextDue).toHaveBeenCalledTimes(3);
  });

  it("limits a cron drain to one due unit", async () => {
    getNextDue.mockResolvedValue(unit);

    await drainReadingIngestQueue("user-1", {
      agentSecret: "test-secret",
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
        agentSecret: "test-secret",
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
      agentSecret: "test-secret",
      dependencies: { reclaim, getNextDue, dispatch },
    });

    expect(reclaim).toHaveBeenCalledWith("user-1");
    expect(dispatch).toHaveBeenCalledWith(
      unit,
      expect.objectContaining({ agentSecret: "test-secret" }),
    );
  });

  it("sweeps the database without propagating a leftover remote URL", async () => {
    listUserIds.mockResolvedValue(["user-1"]);

    await expect(
      sweepReadingIngestQueues({
        agentSecret: "test-secret",
        dependencies: { listUserIds, reclaim, drain },
      }),
    ).resolves.toBe(1);

    expect(reclaim).toHaveBeenCalledWith("user-1");
    expect(drain).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ agentSecret: "test-secret", maxUnits: 1 }),
    );
  });
});

describe("local reading ingest sweep", () => {
  const readyEnv = {
    isDev: true,
    nodeEnv: "development",
    vitest: undefined,
    databaseUrl: "postgres://configured",
    agentSecret: "test-secret",
  };

  afterEach(() => {
    resetLocalReadingIngestSweep();
  });

  it("does not start without a database or secret, or outside development", () => {
    expect(shouldStartLocalReadingIngestSweep({ ...readyEnv, isDev: false })).toBe(false);
    expect(shouldStartLocalReadingIngestSweep({ ...readyEnv, nodeEnv: "test" })).toBe(false);
    expect(shouldStartLocalReadingIngestSweep({ ...readyEnv, vitest: "true" })).toBe(false);
    expect(shouldStartLocalReadingIngestSweep({ ...readyEnv, databaseUrl: "" })).toBe(false);
    expect(shouldStartLocalReadingIngestSweep({ ...readyEnv, agentSecret: "" })).toBe(false);
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
