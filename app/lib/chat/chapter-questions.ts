import { get, set } from "idb-keyval";
import { getChapterQuestionsStore } from "~/lib/sync/stores";

export type ChapterQuestions = readonly [string, string, string];

function parseQuestions(value: unknown): ChapterQuestions | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const questions = value.map((question) =>
    typeof question === "string" ? question.trim() : question,
  );
  if (questions.some((question) => typeof question !== "string" || question.length === 0)) {
    return null;
  }
  return questions as unknown as ChapterQuestions;
}

function cacheKey(bookId: string, chapterIndex: number): string {
  return JSON.stringify([bookId, chapterIndex]);
}

export async function loadChapterQuestions(
  bookId: string,
  chapterIndex: number,
): Promise<ChapterQuestions> {
  const key = cacheKey(bookId, chapterIndex);
  try {
    const cached = parseQuestions(await get<unknown>(key, getChapterQuestionsStore()));
    if (cached) return cached;
  } catch {
    // A cache read failure should not prevent a network attempt.
  }

  const response = await globalThis.fetch("/api/chapter-questions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookId, chapterIndex }),
  });
  if (!response.ok) throw new Error(`Chapter questions request failed: ${response.status}`);

  const questions = parseQuestions(await response.json());
  if (!questions) throw new Error("Invalid chapter questions response");
  try {
    await set(key, questions, getChapterQuestionsStore());
  } catch {
    // The generated questions are still usable when local caching fails.
  }
  return questions;
}
