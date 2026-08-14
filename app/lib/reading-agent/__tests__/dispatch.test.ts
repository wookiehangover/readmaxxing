import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ReadingArtifactRow,
  ReadingIngestUnitRow,
} from "~/lib/database/reading-artifact/reading-artifact";
import { dispatchReadingIngestUnit, readingConversationId } from "../dispatch.server";

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
const wiki: ReadingArtifactRow = {
  userId: "user-1",
  bookId: "book-1",
  kind: "wiki",
  content: "Existing story.",
  revisionId: "revision-1",
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const claim = vi.fn();
const complete = vi.fn();
const getCurrent = vi.fn();
const release = vi.fn();
const callAgent = vi.fn();

beforeEach(() => {
  claim.mockReset().mockResolvedValue(claimed);
  complete.mockReset().mockResolvedValue(1);
  getCurrent.mockReset().mockResolvedValue([wiki]);
  release.mockReset().mockResolvedValue(undefined);
  callAgent.mockReset().mockResolvedValue({
    outline: { status: "unchanged", body: "", summary: "No outline change." },
    characters: { status: "unchanged", body: "", summary: "No character change." },
    wiki: { status: "updated", body: "Expanded story.", summary: "Added the new scene." },
  });
});

const options = () => ({
  agentUrl: "http://localhost:5174/agents/reading-scribe",
  agentSecret: "test-secret",
  dependencies: { claim, complete, getCurrent, release, callAgent },
});

describe("reading ingest dispatch", () => {
  it("persists only a changed wiki edit and completes the unit", async () => {
    await expect(dispatchReadingIngestUnit(unit, options())).resolves.toBe("done");

    expect(complete).toHaveBeenCalledWith(claimed, [
      { kind: "wiki", content: "Expanded story.", summary: "Added the new scene." },
    ]);
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
    expect(release).toHaveBeenCalledWith("unit-1", "Flue unavailable");
  });

  it("leaves the unit pending when the sidecar is not configured", async () => {
    await expect(
      dispatchReadingIngestUnit(unit, {
        agentUrl: "",
        agentSecret: "",
        dependencies: options().dependencies,
      }),
    ).resolves.toBe("not-configured");

    expect(claim).not.toHaveBeenCalled();
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
});
