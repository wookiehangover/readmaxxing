import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ReadingArtifactRow,
  ReadingIngestUnitRow,
} from "~/lib/database/reading-artifact/reading-artifact";
import {
  dispatchReadingIngestUnit,
  drainReadingIngestQueue,
  readingConversationId,
} from "../dispatch.server";

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

const claimLease = vi.fn();
const complete = vi.fn();
const getCurrent = vi.fn();
const release = vi.fn();
const callAgent = vi.fn();
const getNextDue = vi.fn();
const dispatch = vi.fn();

beforeEach(() => {
  claimLease.mockReset().mockResolvedValue(leased);
  complete.mockReset().mockResolvedValue(1);
  getCurrent.mockReset().mockResolvedValue([wiki]);
  release.mockReset().mockResolvedValue(undefined);
  getNextDue.mockReset().mockResolvedValue(null);
  dispatch.mockReset().mockResolvedValue("done");
  callAgent.mockReset().mockResolvedValue({
    artifacts: {
      outline: { status: "unchanged", body: "", summary: "No outline change." },
      characters: { status: "unchanged", body: "", summary: "No character change." },
      wiki: { status: "updated", body: "Expanded story.", summary: "Added the new scene." },
    },
    usage: {
      input: 100,
      output: 20,
      cacheRead: 5,
      cacheWrite: 0,
      totalTokens: 125,
      costTotal: 0.001,
      model: "anthropic/claude-sonnet-4-6",
      source: "flue",
    },
  });
});

const options = () => ({
  agentUrl: "http://localhost:5174/agents/reading-scribe",
  agentSecret: "test-secret",
  dependencies: { claimLease, complete, getCurrent, release, callAgent },
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
      }),
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
  });

  it("does not dispatch when the user already has a lease", async () => {
    claimLease.mockResolvedValue(null);

    await expect(dispatchReadingIngestUnit(unit, options())).resolves.toBe("already-leased");

    expect(callAgent).not.toHaveBeenCalled();
  });

  it("leaves the unit pending when the sidecar is not configured", async () => {
    await expect(
      dispatchReadingIngestUnit(unit, {
        agentUrl: "",
        agentSecret: "",
        dependencies: options().dependencies,
      }),
    ).resolves.toBe("not-configured");

    expect(claimLease).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("uses a stable, opaque conversation id per user and book", () => {
    expect(readingConversationId("user-1", "book-1")).toBe(
      readingConversationId("user-1", "book-1"),
    );
    expect(readingConversationId("user-1", "book-1")).not.toBe(
      readingConversationId("user-1", "book-2"),
    );
  });

  it("does nothing when the queue is empty or a user lease is busy", async () => {
    await expect(
      drainReadingIngestQueue("user-1", {
        agentUrl: "http://localhost:5174/agents/reading-scribe",
        agentSecret: "test-secret",
        dependencies: { getNextDue, dispatch },
      }),
    ).resolves.toBeUndefined();

    expect(getNextDue).toHaveBeenCalledWith("user-1");
    expect(dispatch).not.toHaveBeenCalled();
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
      agentUrl: "http://localhost:5174/agents/reading-scribe",
      agentSecret: "test-secret",
      dependencies: { getNextDue, dispatch },
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

  it("does not inspect or dispatch the queue without agent configuration", async () => {
    await drainReadingIngestQueue("user-1", {
      agentUrl: "",
      agentSecret: "",
      dependencies: { getNextDue, dispatch },
    });

    expect(getNextDue).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
