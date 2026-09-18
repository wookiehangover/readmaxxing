import { beforeEach, expect, it, vi } from "vitest";
import { InvalidResponseDataError } from "ai";

const doEvaluate = vi.hoisted(() => vi.fn());
vi.mock("@ai-sdk/gateway", () => ({
  gateway: {
    evaluationModel: () => ({
      specificationVersion: "v4",
      provider: "test",
      modelId: "typesafe-ai/jev",
      supportedQuestionTypes: ["score"],
      doEvaluate,
    }),
  },
}));
import { evaluateOutlineBullets, JevEvaluationError } from "../jev.server";
import { pageIncrementUsageFromError } from "../page-increment.server";

const context = { page: "Mara leaves home.", chapterLabel: "One", existingBullets: [] };
const validAnswers = () =>
  Object.fromEntries(
    ["relevance", "accuracy", "consistency"].map((dimension) => [
      `bullet_0_${dimension}`,
      { type: "score", score: 2, probabilities: { "0": 0, "1": 0, "2": 1 } },
    ]),
  );

beforeEach(() => {
  doEvaluate.mockReset();
});

it.each(["missing", "out-of-range", "probabilities"])(
  "retains provider usage when the real SDK rejects %s answers",
  async (failure) => {
    const answers = validAnswers();
    if (failure === "missing") delete answers.bullet_0_accuracy;
    if (failure === "out-of-range") answers.bullet_0_accuracy.score = 3;
    if (failure === "probabilities")
      answers.bullet_0_accuracy.probabilities = { "0": 1, "1": 1, "2": 1 };
    doEvaluate.mockResolvedValue({
      answers,
      usage: { inputTokens: 25, outputTokens: 3 },
      warnings: [],
    });
    try {
      await evaluateOutlineBullets(context, ["Mara leaves home."], 1, AbortSignal.timeout(1000));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(JevEvaluationError);
      expect((error as Error).cause).toBeInstanceOf(InvalidResponseDataError);
      expect(pageIncrementUsageFromError(error, "openai/gpt-5.5")).toMatchObject({
        input: 25,
        output: 3,
        totalTokens: 28,
        model: "typesafe-ai/jev",
      });
    }
  },
);

it("preserves normal SDK validation and normalized scores for valid provider answers", async () => {
  doEvaluate.mockResolvedValue({
    answers: validAnswers(),
    usage: { inputTokens: 25, outputTokens: 3 },
    warnings: [],
  });
  const result = await evaluateOutlineBullets(
    context,
    ["Mara leaves home."],
    1,
    AbortSignal.timeout(1000),
  );
  expect(result.ratings[0]).toMatchObject({ rating: 1, accepted: true });
  expect(result.usage.totalTokens).toBe(28);
});

it.each([
  { attempt: 1, score: 1.5, accepted: true },
  { attempt: 1, score: 1.499, accepted: false },
  { attempt: 1, score: 1.4, accepted: false },
  { attempt: 2, score: 1.4, accepted: true },
  { attempt: 2, score: 1.399, accepted: false },
  { attempt: 3, score: 1.4, accepted: true },
  { attempt: 3, score: 1.399, accepted: false },
])(
  "uses the acceptance threshold for attempt $attempt at score $score",
  async ({ attempt, score, accepted }) => {
    const answers = validAnswers();
    for (const key of Object.keys(answers)) {
      answers[key] = {
        type: "score",
        score,
        probabilities: { "0": 0, "1": 2 - score, "2": score - 1 },
      };
    }
    doEvaluate.mockResolvedValue({
      answers,
      usage: { inputTokens: 25, outputTokens: 3 },
      warnings: [],
    });
    const result = await evaluateOutlineBullets(
      context,
      ["Mara leaves home."],
      attempt,
      AbortSignal.timeout(1000),
    );
    expect(result.ratings[0]).toMatchObject({ attempt, accepted });
    expect(result.ratings[0].rating).toBeCloseTo(score / 2, 12);
  },
);
