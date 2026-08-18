import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoObjectGeneratedError } from "ai";

const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  gateway: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateObject: mocks.generateObject,
}));
vi.mock("@ai-sdk/gateway", () => ({ gateway: mocks.gateway }));

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

beforeEach(() => {
  mocks.generateObject.mockReset().mockResolvedValue({
    object: { bullets: ["A traveler leaves home."] },
    usage,
    response: { modelId: "anthropic/claude-sonnet-4.6" },
  });
  mocks.gateway.mockReset().mockReturnValue({ provider: "gateway-model" });
});

describe("callPageIncrement", () => {
  it("makes one structured Gateway call with only this chapter's context", async () => {
    await expect(
      callPageIncrement({
        model: "anthropic/claude-sonnet-4-6",
        chapterLabel: "One: Departure",
        existingBullets: ["The traveler questions his teachers."],
        page: "The traveler decides to leave home.",
      }),
    ).resolves.toEqual({
      bullets: ["A traveler leaves home."],
      usage: {
        input: 100,
        output: 20,
        cacheRead: 10,
        cacheWrite: 2,
        totalTokens: 120,
        costTotal: 0,
        model: "anthropic/claude-sonnet-4.6",
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
