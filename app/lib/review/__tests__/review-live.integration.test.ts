// @vitest-environment node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { parseHTML } from "linkedom";
import { expect, it } from "vitest";
import {
  generateReviewQuestion,
  gradeReviewAnswer,
  REVIEW_MODEL,
  REVIEW_MODEL_TIMEOUT_MS,
} from "../review-model.server";
import { reviewGenerationInstructions, reviewGradingInstructions } from "../review-prompts.server";
import { fingerprintReviewChapter, normalizeReviewChapterText } from "../chapter-identity";
import {
  REVIEW_GENERATION_VERSION,
  REVIEW_PROMPT_VERSION,
  REVIEW_SCHEMA_VERSION,
} from "../review-types";
import type { ReviewQuestionRecord } from "~/lib/database/review/review-records.server";
import { ReviewApiFailure } from "../review-errors.server";

/** Explicit opt-in: at most two generations and six grades, no retries and no external DB. */
it.skipIf(process.env.RUN_REVIEW_LIVE_SAMPLE !== "1")(
  "samples the production review model with a public-domain chapter",
  async () => {
    const archive = unzipSync(await readFile("public/demo/the-great-gatsby.epub"));
    const { document } = parseHTML(strFromU8(archive["epub/text/chapter-1.xhtml"]));
    const chapterText = normalizeReviewChapterText(
      document.querySelector("body")!.textContent ?? "",
    );
    const answers = {
      weak: "My favorite breakfast is pancakes. I have not read the chapter and cannot explain its events or support an interpretation.",
      partial:
        "Nick presents himself as someone who reserves judgment. He moves to West Egg and visits Daisy and Tom in East Egg. The dinner shows that their wealthy life is not happy: Tom receives a call from another woman, and Daisy sounds disappointed. At the end Gatsby reaches toward a green light across the water. These details suggest that money does not guarantee contentment.",
      strong:
        "Nick's claim to reserve judgment is a qualification on his authority, not proof that his account is neutral. His father's advice connects judgment to unequal advantages, yet Nick sorts the people he meets into sharply evaluated social types. His family history and access to Daisy also place him inside the privileged world he describes. The reader therefore receives an observant account shaped by attraction and discomfort rather than an impartial survey.\n\nThe dinner makes the gap between material comfort and secure belonging concrete. Tom's physical dominance and racial assertions turn inherited advantage into a claim to authority; the interrupted meal exposes how little that authority depends on care for Daisy. Her remark about hoping her daughter is a beautiful fool can be read as cynicism about the roles available to women in that setting, although Nick's uncertainty about her sincerity cautions against treating it as a complete confession. Jordan's detached manner offers another response to the same social environment.\n\nGatsby's reaching toward the distant green light changes the chapter's emphasis from possession to desire. Nick sees the gesture but cannot yet establish its object or motive, so it supports an interpretation of longing without licensing a later-chapter explanation. The contrast with Tom matters: one figure occupies and asserts his place, while the other reaches beyond his immediate position. If the chapter ended with the dinner alone, wealth's defensiveness would dominate; ending with an obscure aspiration leaves open whether desire offers an alternative or repeats the same dependence on status. That ambiguity is a limit on Nick's knowledge and on this reading, not an invitation to invent Gatsby's history.",
    };
    const difficulties = ["friendly", "tyler_cowen"] as const;
    const gradingLevels = ["reading_group", "tyler_cowen"] as const;
    const report: Record<string, unknown> = {
      sampledAt: new Date().toISOString(),
      source:
        "public/demo/the-great-gatsby.epub#epub/text/chapter-1.xhtml (entire chapter, no clipping)",
      sourceSha256: createHash("sha256").update(chapterText).digest("hex"),
      chapterBytes: Buffer.byteLength(chapterText),
      model: REVIEW_MODEL,
      provider: "ai-gateway",
      generationVersion: REVIEW_GENERATION_VERSION,
      promptVersion: REVIEW_PROMPT_VERSION,
      schemaVersion: REVIEW_SCHEMA_VERSION,
      timeoutMs: REVIEW_MODEL_TIMEOUT_MS,
      maxRetries: 0,
      maxOutputTokens: { generation: 6000, grading: 3000 },
      credentialsPresent: Object.fromEntries(
        ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"].map((name) => [
          name,
          Boolean(process.env[name]),
        ]),
      ),
      generationInstructions: Object.fromEntries(
        difficulties.map((difficulty) => [difficulty, reviewGenerationInstructions(difficulty)]),
      ),
      gradingInstructions: Object.fromEntries(
        gradingLevels.map((grading) => [grading, reviewGradingInstructions(grading)]),
      ),
      generationPrompt: JSON.stringify({ chapterText }),
      authoredAnswers: answers,
      results: [],
      limitation:
        "This bounded sample is observational. Answer labels describe author intent, not expected model verdicts; review question fit and outputs manually.",
    };
    const results = report.results as unknown[];
    try {
      const questions: ReviewQuestionRecord[] = [];
      for (const difficulty of difficulties) {
        const generated = await generateReviewQuestion(chapterText, difficulty);
        const question = {
          ...generated,
          id: `sample-${difficulty}`,
          sourceFingerprint: await fingerprintReviewChapter(chapterText),
          generationVersion: REVIEW_GENERATION_VERSION,
          schemaVersion: REVIEW_SCHEMA_VERSION,
          promptVersion: REVIEW_PROMPT_VERSION,
          createdAt: Date.now(),
        };
        questions.push(question);
        results.push({ operation: "generation", difficulty, question });
        expect(question.question.length).toBeGreaterThanOrEqual(160);
      }
      for (const grading of gradingLevels) {
        for (const [label, plainText] of Object.entries(answers)) {
          const question = questions[0];
          const judgment = await gradeReviewAnswer({ chapterText, question, plainText, grading });
          results.push({
            operation: "grading",
            grading,
            answerLabel: label,
            prompt: JSON.stringify({
              chapterText,
              question: question.question,
              rubric: question.rubric,
              submittedAnswer: plainText,
            }),
            judgment,
          });
        }
      }
      report.status = "sampled";
    } catch (error) {
      report.status = "unavailable_or_failed";
      report.failure =
        error instanceof ReviewApiFailure
          ? { code: error.code, message: error.message }
          : { name: error instanceof Error ? error.name : "UnknownError" };
      throw error;
    } finally {
      await mkdir(".intent/artifacts", { recursive: true });
      await writeFile(
        ".intent/artifacts/final-live-review-sample.json",
        JSON.stringify(report, null, 2),
      );
    }
  },
  370_000,
);
