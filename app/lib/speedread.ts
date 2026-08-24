export const DEFAULT_SPEEDREAD_WPM = 300;
export const MIN_SPEEDREAD_WPM = 100;
export const MAX_SPEEDREAD_WPM = 900;
export const SPEEDREAD_WPM_STORAGE_KEY = "speedread-wpm";
export const SPEEDREAD_PROGRESS_STORAGE_PREFIX = "speedread-progress:";

export interface SpeedreadProgress {
  wordIndex: number;
  fingerprint: string;
}

export function tokenizeSpeedreadText(text: string): string[] {
  const normalized = text.trim();
  return normalized ? normalized.split(/\s+/) : [];
}

export function speedreadIntervalMs(wpm: number): number {
  if (!Number.isFinite(wpm) || wpm <= 0) {
    throw new RangeError("WPM must be a positive finite number");
  }
  return 60_000 / wpm;
}

export function clampSpeedreadWpm(wpm: unknown): number {
  if (typeof wpm !== "number" || !Number.isFinite(wpm)) return DEFAULT_SPEEDREAD_WPM;
  return Math.min(Math.max(wpm, MIN_SPEEDREAD_WPM), MAX_SPEEDREAD_WPM);
}

export function parseStoredSpeedreadWpm(value: string | null): number {
  if (value === null || value.trim() === "") return DEFAULT_SPEEDREAD_WPM;
  return clampSpeedreadWpm(Number(value));
}

export function fingerprintSpeedreadWords(words: readonly string[]): string {
  let hash = 2_166_136_261;
  for (const word of words) {
    hash = Math.imul(hash ^ word.length, 16_777_619);
    for (let index = 0; index < word.length; index += 1) {
      hash = Math.imul(hash ^ word.charCodeAt(index), 16_777_619);
    }
  }
  return `${words.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function speedreadProgressStorageKey(bookId: string): string {
  return `${SPEEDREAD_PROGRESS_STORAGE_PREFIX}${bookId}`;
}

export function clampSpeedreadWordIndex(wordIndex: number, wordCount: number): number {
  if (!Number.isFinite(wordIndex) || wordCount <= 0) return 0;
  return Math.min(Math.max(0, Math.trunc(wordIndex)), wordCount - 1);
}

export function resolveSpeedreadWordIndex(
  progress: unknown,
  fingerprint: string,
  wordCount: number,
): number {
  if (
    typeof progress !== "object" ||
    progress === null ||
    !("wordIndex" in progress) ||
    !("fingerprint" in progress) ||
    typeof progress.wordIndex !== "number" ||
    typeof progress.fingerprint !== "string" ||
    progress.fingerprint !== fingerprint
  ) {
    return 0;
  }
  return clampSpeedreadWordIndex(progress.wordIndex, wordCount);
}
