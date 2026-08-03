import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SPEEDREAD_WPM_STORAGE_KEY,
  clampSpeedreadWpm,
  fingerprintSpeedreadWords,
  parseStoredSpeedreadWpm,
  resolveSpeedreadWordIndex,
  speedreadIntervalMs,
  speedreadProgressStorageKey,
  type SpeedreadProgress,
} from "~/lib/speedread";

function loadWpm(): number {
  if (typeof window === "undefined") return parseStoredSpeedreadWpm(null);
  try {
    return parseStoredSpeedreadWpm(window.localStorage.getItem(SPEEDREAD_WPM_STORAGE_KEY));
  } catch {
    return parseStoredSpeedreadWpm(null);
  }
}

function saveWpm(wpm: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SPEEDREAD_WPM_STORAGE_KEY, String(wpm));
  } catch {
    // WPM persistence is optional when storage is unavailable.
  }
}

function loadProgress(bookId: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(window.localStorage.getItem(speedreadProgressStorageKey(bookId)) ?? "null");
  } catch {
    return null;
  }
}

function saveProgress(bookId: string, progress: SpeedreadProgress): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(speedreadProgressStorageKey(bookId), JSON.stringify(progress));
  } catch {
    // Reading progress persistence is optional when storage is unavailable.
  }
}

export function useSpeedreadPlayback(words: readonly string[], bookId: string) {
  const fingerprint = useMemo(() => fingerprintSpeedreadWords(words), [words]);
  const progressScope = `${bookId}\u0000${fingerprint}`;
  const wordIndexScopeRef = useRef(progressScope);
  const [wordIndex, setWordIndex] = useState(() =>
    resolveSpeedreadWordIndex(loadProgress(bookId), fingerprint, words.length),
  );
  const [wpm, setWpmState] = useState(loadWpm);
  const [isPlaying, setIsPlaying] = useState(false);

  const setWpm = useCallback((nextWpm: number) => {
    const clampedWpm = clampSpeedreadWpm(nextWpm);
    setWpmState(clampedWpm);
    saveWpm(clampedWpm);
  }, []);

  const persistProgress = useCallback(() => {
    saveProgress(bookId, { wordIndex, fingerprint });
  }, [bookId, fingerprint, wordIndex]);

  useEffect(() => {
    if (wordIndexScopeRef.current !== progressScope) return;
    persistProgress();
  }, [persistProgress, progressScope]);

  useEffect(() => {
    if (wordIndexScopeRef.current === progressScope) return;
    wordIndexScopeRef.current = progressScope;
    setWordIndex(resolveSpeedreadWordIndex(loadProgress(bookId), fingerprint, words.length));
    setIsPlaying(false);
  }, [bookId, fingerprint, progressScope, words.length]);

  useEffect(() => {
    if (!isPlaying || wordIndex >= words.length - 1) return;

    const timer = window.setTimeout(() => {
      const nextIndex = wordIndex + 1;
      setWordIndex(nextIndex);
      if (nextIndex === words.length - 1) setIsPlaying(false);
    }, speedreadIntervalMs(wpm));

    return () => window.clearTimeout(timer);
  }, [isPlaying, wordIndex, words.length, wpm]);

  const togglePlayback = useCallback(() => {
    if (words.length === 0 || wordIndex >= words.length - 1) return;
    setIsPlaying((playing) => !playing);
  }, [wordIndex, words.length]);

  return {
    currentWord: words[wordIndex] ?? null,
    isPlaying,
    persistProgress,
    setWpm,
    togglePlayback,
    wordIndex,
    wpm,
  };
}
