import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoObjectGeneratedError } from "ai";

const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  gateway: vi.fn(),
  evaluate: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateObject: mocks.generateObject,
  experimental_evaluate: mocks.evaluate,
}));
vi.mock("@ai-sdk/gateway", () => ({
  gateway: Object.assign(mocks.gateway, { evaluationModel: vi.fn(() => ({ provider: "jev" })) }),
}));

import {
  callPageIncrement,
  PAGE_INCREMENT_TIMEOUT_MS,
  pageIncrementUsageFromError,
} from "../page-increment.server";

const usage = {
  inputTokens: 100,
  inputTokenDetails: { noCacheTokens: 90, cacheReadTokens: 10, cacheWriteTokens: 2 },
  outputTokens: 20,
  outputTokenDetails: { textTokens: 20, reasoningTokens: 0 },
  totalTokens: 120,
};

function evaluation(scores = [2]) {
  return {
    answers: Object.fromEntries(
      scores.flatMap((score, index) =>
        ["relevance", "accuracy", "consistency"].map((dimension) => [
          `bullet_${index}_${dimension}`,
          { type: "score", score },
        ]),
      ),
    ),
    usage: { inputTokens: 30, outputTokens: 0, totalTokens: 30 },
  };
}

beforeEach(() => {
  mocks.evaluate.mockReset().mockResolvedValue(evaluation());
  mocks.generateObject.mockReset().mockResolvedValue({
    object: { bullets: ["A traveler leaves home."] },
    usage,
    response: { modelId: "anthropic/claude-sonnet-4.6" },
  });
  mocks.gateway.mockReset().mockReturnValue({ provider: "gateway-model" });
});

describe("callPageIncrement", () => {
  it("generates and evaluates with chapter and adjacent-page context", async () => {
    await expect(
      callPageIncrement({
        model: "anthropic/claude-sonnet-4-6",
        chapterLabel: "One: Departure",
        existingBullets: ["The traveler questions his teachers."],
        page: "The traveler decides to leave home.",
        previousPage: "The traveler is named Mara.",
        nextPage: "She closes the door.",
      }),
    ).resolves.toMatchObject({
      bullets: ["A traveler leaves home."],
      usage: {
        input: 130,
        output: 20,
        cacheRead: 10,
        cacheWrite: 2,
        totalTokens: 150,
        costTotal: 0,
        model: "anthropic/claude-sonnet-4.6, typesafe-ai/jev",
        source: "ai-sdk",
      },
    });

    expect(mocks.gateway).toHaveBeenCalledOnce();
    expect(mocks.gateway).toHaveBeenCalledWith("anthropic/claude-sonnet-4.6");
    expect(mocks.generateObject).toHaveBeenCalledOnce();
    const request = mocks.generateObject.mock.calls[0]?.[0];
    expect(JSON.parse(request.prompt)).toEqual({
      chapterLabel: "One: Departure",
      existingBullets: ["The traveler questions his teachers."],
      pageText: "The traveler decides to leave home.",
      previousPage: "The traveler is named Mara.",
      nextPage: "She closes the door.",
    });
    expect(mocks.evaluate.mock.calls[0][0]).toMatchObject({
      state: {
        currentPage: "The traveler decides to leave home.",
        previousPage: "The traveler is named Mara.",
        nextPage: "She closes the door.",
      },
      maxRetries: 0,
    });
    expect(request.abortSignal).toBeInstanceOf(AbortSignal);
    expect(request.maxRetries).toBe(0);
    expect(request.instructions).toContain('Never use the phrase "The author"');
    for (const example of [
      "The train reaches Moscow before dawn.",
      "Mara hides the letter under the floorboards.",
      "The treaty establishes a ten-year ceasefire.",
      "The author reveals that Mara is afraid.",
      "This moving scene proves courage conquers fear.",
      "- The train reaches Moscow before dawn.",
    ]) {
      expect(request.instructions).toContain(example);
    }
    expect(PAGE_INCREMENT_TIMEOUT_MS).toBe(60_000);
    expect(request.schema.safeParse({ bullets: [] }).success).toBe(true);
    expect(request.schema.safeParse({ bullets: ["1", "2", "3", "4"] }).success).toBe(false);
  });

  it("uses the selected non-Claude model unchanged and accepts an empty increment", async () => {
    mocks.generateObject.mockResolvedValue({
      object: { bullets: [] },
      usage,
      response: { modelId: "openai/gpt-5.6-sol" },
    });

    await expect(
      callPageIncrement({
        model: "openai/gpt-5.6-sol",
        chapterLabel: null,
        existingBullets: [],
        page: "A page without new factual information.",
      }),
    ).resolves.toMatchObject({ bullets: [], usage: { model: "openai/gpt-5.6-sol" } });
    expect(mocks.gateway).toHaveBeenCalledWith("openai/gpt-5.6-sol");
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });
});

describe("pageIncrementUsageFromError", () => {
  it("preserves usage and the response model from a structured-output failure", () => {
    const error = new NoObjectGeneratedError({
      message: "Invalid structured response",
      response: {
        id: "response-1",
        timestamp: new Date("2026-01-01T00:00:00Z"),
        modelId: "google/gemini-2.5-flash",
      },
      usage,
      finishReason: "stop",
    });

    expect(pageIncrementUsageFromError(error, "openai/gpt-5.5")).toMatchObject({
      input: 100,
      output: 20,
      totalTokens: 120,
      model: "google/gemini-2.5-flash",
      source: "ai-sdk",
    });
  });

  it("records a zero-token AI SDK attempt when no result usage is available", () => {
    expect(pageIncrementUsageFromError(new Error("Gateway unavailable"), "xai/grok-4.5")).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      costTotal: 0,
      model: "xai/grok-4.5",
      source: "ai-sdk",
    });
  });
});

const options = {
  model: "openai/gpt-5.5" as const,
  page: "Mara leaves home. Ivo stays.",
  chapterLabel: "One",
  existingBullets: [],
};

describe("bullet quality control", () => {
  it("preserves passing bullets and regenerates only a failed bullet with its ratings", async () => {
    mocks.generateObject.mockResolvedValueOnce({
      object: { bullets: ["Mara leaves.", "Ivo leaves."] },
      usage,
      response: { modelId: options.model },
    });
    mocks.evaluate.mockResolvedValueOnce(evaluation([2, 0.5]));
    const result = await callPageIncrement(options);
    expect(result.bullets).toEqual(["Mara leaves.", "A traveler leaves home."]);
    expect(mocks.generateObject).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mocks.generateObject.mock.calls[1][0].prompt)).toMatchObject({
      existingBullets: ["Mara leaves."],
      repair: { bullet: "Ivo leaves.", accuracy: 0.25, attempt: 1 },
    });
    expect(result.usage.quality).toHaveLength(3);
    expect(result.usage.totalTokens).toBe(300);
  });

  it("stops at three failed evaluations and completes without the rejected bullet", async () => {
    mocks.evaluate.mockResolvedValue(evaluation([0.2]));
    const result = await callPageIncrement(options);
    expect(result.bullets).toEqual([]);
    expect(mocks.generateObject).toHaveBeenCalledTimes(3);
    expect(mocks.evaluate).toHaveBeenCalledTimes(3);
    expect(result.usage.quality?.map((r) => r.attempt)).toEqual([1, 2, 3]);
  });

  it("retries a below-threshold average and accepts 70% on retry", async () => {
    const first = evaluation([2]);
    first.answers.bullet_0_accuracy.score = 0.49;
    mocks.evaluate.mockResolvedValueOnce(first).mockResolvedValueOnce(evaluation([1.4]));
    const result = await callPageIncrement(options);
    expect(mocks.generateObject).toHaveBeenCalledTimes(2);
    expect(result.usage.quality?.map((r) => r.accepted)).toEqual([false, true]);
  });

  it("accepts a passing average even when one dimension is below the cutoff", async () => {
    const first = evaluation([2]);
    first.answers.bullet_0_accuracy.score = 0.5;
    mocks.evaluate.mockResolvedValueOnce(first);
    const result = await callPageIncrement(options);
    expect(mocks.generateObject).toHaveBeenCalledOnce();
    expect(result.usage.quality).toMatchObject([
      { relevance: 1, accuracy: 0.25, consistency: 1, rating: 0.75, accepted: true },
    ]);
  });

  it("accepts 75% initially without regenerating", async () => {
    mocks.evaluate.mockResolvedValueOnce(evaluation([1.5]));
    const result = await callPageIncrement(options);
    expect(mocks.generateObject).toHaveBeenCalledOnce();
    expect(result.usage.quality).toMatchObject([{ attempt: 1, rating: 0.75, accepted: true }]);
  });

  it("keeps the 70% threshold for the final retry", async () => {
    mocks.evaluate
      .mockResolvedValueOnce(evaluation([1.4]))
      .mockResolvedValueOnce(evaluation([1.39]))
      .mockResolvedValueOnce(evaluation([1.4]));
    const result = await callPageIncrement(options);
    expect(mocks.generateObject).toHaveBeenCalledTimes(3);
    expect(result.usage.quality?.map((rating) => rating.accepted)).toEqual([false, false, true]);
    expect(result.bullets).toEqual(["A traveler leaves home."]);
  });

  it("can remove an unsupported bullet without evaluating an empty replacement", async () => {
    mocks.evaluate.mockResolvedValueOnce(evaluation([0]));
    mocks.generateObject
      .mockResolvedValueOnce({
        object: { bullets: ["Unsupported."] },
        usage,
        response: { modelId: options.model },
      })
      .mockResolvedValueOnce({
        object: { bullets: [] },
        usage,
        response: { modelId: options.model },
      });
    expect((await callPageIncrement(options)).bullets).toEqual([]);
    expect(mocks.evaluate).toHaveBeenCalledOnce();
  });

  it.each([NaN, -1, 3])("rejects malformed Jev score %s without publishing", async (score) => {
    mocks.evaluate.mockResolvedValue(evaluation([score]));
    try {
      await callPageIncrement(options);
      expect.unreachable();
    } catch (error) {
      expect(pageIncrementUsageFromError(error, options.model).totalTokens).toBe(150);
    }
  });

  it("fails closed and preserves generation usage if Jev is unavailable", async () => {
    mocks.evaluate.mockRejectedValue(new Error("Jev unavailable"));
    try {
      await callPageIncrement(options);
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ message: "Jev unavailable" });
      expect(pageIncrementUsageFromError(error, options.model).totalTokens).toBe(120);
    }
  });
});
