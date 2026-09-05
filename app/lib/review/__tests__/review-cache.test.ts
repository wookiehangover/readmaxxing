import { clear, get, set } from "idb-keyval";
import { afterEach, describe, expect, it, vi } from "vitest";
import { upsertItem } from "@augmentcode/themis/utils/collections/collection-utils";
import { getReviewsStore } from "~/lib/sync/stores";
import {
  emptyReviewCache,
  mergeReviewProgress,
  reviewAssignmentId,
} from "~/lib/themis/reviews/reviews-records";
import {
  boundary,
  document,
  fingerprint,
  questionResponse,
  submitResponse,
} from "~/lib/themis/reviews/reviews-test-fixtures";
import { loadReviewCache, saveReviewCache } from "../review-cache";

afterEach(async () => {
  vi.unstubAllGlobals();
  await clear(getReviewsStore());
});

describe("review IndexedDB persistence", () => {
  it("round-trips scoped preferences, active boundary, immutable outcomes and rich drafts", async () => {
    const response = questionResponse();
    const id = reviewAssignmentId(boundary.key, fingerprint);
    const result = submitResponse({
      id: "attempt-1",
      bookId: "book-1",
      chapterKey: boundary.key,
      questionId: response.question.id,
      grading: "reading_group",
      document: document(),
      plainText: "A thoughtful answer with more than thirty characters.",
    });
    let cache = mergeReviewProgress(emptyReviewCache("user-1", "book-1"), {
      progress: [response.progress],
      attempts: [result.attempt],
    });
    cache = {
      ...cache,
      preferences: { enabled: true, difficulty: "challenging", grading: "elite_professor" },
      activeChapterKey: boundary.key,
      presentation: "reading",
      checkpoints: upsertItem(cache.checkpoints, {
        ...boundary,
        chapterIndex: 0,
        sourceFingerprint: fingerprint,
        returnLocator: "epubcfi(/6/2)",
      }),
      questions: upsertItem(cache.questions, response.question),
      drafts: upsertItem(cache.drafts, {
        id,
        documentJson: JSON.stringify(document("Offline draft")),
        revision: 2,
        updatedAt: 5,
      }),
      submission: { id: "retry-id", draftId: id, draftRevision: 2, grading: "elite_professor" },
    };
    await saveReviewCache(cache);
    expect(await loadReviewCache("user-1", "book-1")).toEqual(cache);
    expect(await loadReviewCache("user-2", "book-1")).toBeNull();
    expect(await loadReviewCache("user-1", "book-2")).toBeNull();
  });
  it("uses collision-safe user/book keys", async () => {
    const first = emptyReviewCache("a:b", "c");
    const second = emptyReviewCache("a", "b:c");
    await Promise.all([saveReviewCache(first), saveReviewCache(second)]);
    expect(await loadReviewCache("a:b", "c")).toEqual(first);
    expect(await loadReviewCache("a", "b:c")).toEqual(second);
  });
  it("restores pre-membership caches and persists explicit invalidation across reload", async () => {
    const cache = mergeReviewProgress(emptyReviewCache("user-1", "book-1"), {
      progress: [questionResponse().progress],
      attempts: [],
    });
    cache.checkpoints = upsertItem(cache.checkpoints, {
      ...boundary,
      chapterIndex: 0,
      sourceFingerprint: fingerprint,
      returnLocator: "return-cfi",
    });
    const { currentAssignmentIds, ...legacy } = cache;
    await set(JSON.stringify(["user-1", "book-1"]), legacy, getReviewsStore());
    expect((await loadReviewCache("user-1", "book-1"))?.currentAssignmentIds).toEqual(
      currentAssignmentIds,
    );
    await saveReviewCache({ ...cache, currentAssignmentIds: [] });
    expect((await loadReviewCache("user-1", "book-1"))?.currentAssignmentIds).toEqual([]);
  });
  it("round-trips an oversized draft without imposing grading limits on local editing", async () => {
    const cache = emptyReviewCache("user-1", "book-1");
    cache.drafts = upsertItem(cache.drafts, {
      id: "draft",
      documentJson: JSON.stringify(document("x".repeat(1_000_001))),
      revision: 1,
      updatedAt: 1,
    });
    await saveReviewCache(cache);
    expect(await loadReviewCache("user-1", "book-1")).toEqual(cache);
  });
  it("serializes competing writes so the newest draft/settings win", async () => {
    const initial = emptyReviewCache("user-1", "book-1");
    const enabled = { ...initial, preferences: { ...initial.preferences, enabled: true } };
    const disabled = {
      ...enabled,
      preferences: { ...enabled.preferences, enabled: false, difficulty: "adversarial" as const },
    };
    await Promise.all([
      saveReviewCache(initial),
      saveReviewCache(enabled),
      saveReviewCache(disabled),
    ]);
    expect(await loadReviewCache("user-1", "book-1")).toEqual(disabled);
  });

  it("waits for queued writes when a book is reopened immediately", async () => {
    const cache = emptyReviewCache("user-1", "book-1");
    await saveReviewCache(cache);
    const next = { ...cache, preferences: { ...cache.preferences, enabled: true } };
    const writing = saveReviewCache(next);
    expect(await loadReviewCache("user-1", "book-1")).toEqual(next);
    await writing;
  });
  it("rejects wrong-owner, corrupt collections and invalid rich text without leaking data", async () => {
    const key = JSON.stringify(["user-1", "book-1"]);
    await set(key, emptyReviewCache("another-user", "book-1"), getReviewsStore());
    await expect(loadReviewCache("user-1", "book-1")).rejects.toThrow("different account");
    const corrupt = emptyReviewCache("user-1", "book-1");
    await set(
      key,
      { ...corrupt, questions: { ...corrupt.questions, ids: ["missing"] } },
      getReviewsStore(),
    );
    await expect(loadReviewCache("user-1", "book-1")).rejects.toThrow();
    await set(
      key,
      {
        ...corrupt,
        drafts: upsertItem(corrupt.drafts, {
          id: "draft",
          documentJson: "not JSON",
          revision: 1,
          updatedAt: 1,
        }),
      },
      getReviewsStore(),
    );
    await expect(loadReviewCache("user-1", "book-1")).rejects.toThrow();
  });
  it("does not open IndexedDB merely by importing cache/accessor modules during SSR", async () => {
    vi.resetModules();
    vi.stubGlobal("indexedDB", undefined);
    await expect(import("~/lib/sync/stores")).resolves.toHaveProperty("getReviewsStore");
    await expect(import("../review-cache")).resolves.toHaveProperty("loadReviewCache");
  });
  it("keeps local drafts separate from the server wire representation", async () => {
    const cache = emptyReviewCache("user-1", "book-1");
    await saveReviewCache(cache);
    expect(await get(JSON.stringify(["user-1", "book-1"]), getReviewsStore())).toHaveProperty(
      "drafts.idField",
      "id",
    );
    expect(cache).not.toHaveProperty("latestAttemptId");
    expect(cache).not.toHaveProperty("passedAttemptId");
  });
});
