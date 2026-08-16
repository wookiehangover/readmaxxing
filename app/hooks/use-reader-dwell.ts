import { useEffect, useRef } from "react";
import type { DockviewPanelApi } from "dockview-react";
import { useAuth } from "~/lib/context/auth-context";
import { useOptionalWorkspace } from "~/lib/context/workspace-context";

export const READER_DWELL_MS = 10_000;
const READER_DWELL_RETRY_DELAYS_MS = [250, 500, 1_000] as const;
const READER_DWELL_NOT_FOUND_RETRY_DELAY_MS = 1_000;

export interface ReadingDwellUnit {
  unitKind: "epub-spine" | "pdf-page";
  locator: string;
  chapterLabel?: string;
  text: string;
}

interface UseReaderDwellOptions {
  bookId: string;
  unit: ReadingDwellUnit | null;
  panelApi?: DockviewPanelApi;
  enabled?: boolean;
  dwellMs?: number;
}

const sentFingerprints = new Set<string>();
const inFlightFingerprints = new Set<string>();

async function computeFingerprint(parts: readonly string[]): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(parts)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }

    const finish = (shouldRetry: boolean) => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", handleAbort);
      resolve(shouldRetry);
    };
    const handleAbort = () => finish(false);
    const timeout = setTimeout(() => finish(true), delayMs);
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

async function postDwellUnit(
  url: string,
  body: string,
  options: { retryNotFound: boolean; signal: AbortSignal },
): Promise<boolean> {
  let transientAttempt = 0;
  while (!options.signal.aborted) {
    let retryDelayMs: number;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: options.signal,
      });
      if (response.ok) return true;

      if (response.status === 404 && options.retryNotFound) {
        retryDelayMs = READER_DWELL_NOT_FOUND_RETRY_DELAY_MS;
      } else {
        const canRetry =
          response.status >= 500 && transientAttempt < READER_DWELL_RETRY_DELAYS_MS.length;
        if (!canRetry) {
          console.error(`Failed to ingest reader dwell unit: HTTP ${response.status}`);
          return false;
        }
        retryDelayMs = READER_DWELL_RETRY_DELAYS_MS[transientAttempt];
        transientAttempt += 1;
      }
    } catch (error) {
      if (options.signal.aborted) return false;
      if (transientAttempt >= READER_DWELL_RETRY_DELAYS_MS.length) {
        console.error("Failed to ingest reader dwell unit:", error);
        return false;
      }
      retryDelayMs = READER_DWELL_RETRY_DELAYS_MS[transientAttempt];
      transientAttempt += 1;
    }

    if (!(await waitForRetry(retryDelayMs, options.signal))) return false;
  }
  return false;
}

export function useReaderDwell({
  bookId,
  unit,
  panelApi,
  enabled = true,
  dwellMs = READER_DWELL_MS,
}: UseReaderDwellOptions): void {
  const { isAuthenticated, user } = useAuth();
  const workspace = useOptionalWorkspace();
  const userId = user?.id ?? null;
  const unitKind = unit?.unitKind ?? null;
  const text = unit?.text.normalize("NFC").trim() ?? "";
  const locator = unit?.locator.trim() ?? "";
  const chapterLabel = unit?.chapterLabel?.trim() || undefined;
  const hasText = Boolean(text);
  const latestContentRef = useRef({ chapterLabel, text });
  latestContentRef.current = { chapterLabel, text };

  useEffect(() => {
    if (!enabled || !isAuthenticated || !userId || !unitKind || !locator || !hasText) return;

    let cancelled = false;
    let fingerprint: string | null = null;
    let panelVisible = panelApi?.isVisible ?? true;
    let remainingMs = dwellMs;
    let startedAt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    const isEligible = () => {
      const activeBookId = workspace?.activeClusterBookIdRef.current;
      return (
        document.visibilityState === "visible" &&
        panelVisible &&
        (activeBookId === null || activeBookId === undefined || activeBookId === bookId)
      );
    };

    const pause = () => {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      remainingMs = Math.max(0, remainingMs - (Date.now() - startedAt));
    };

    const send = () => {
      if (
        !fingerprint ||
        sentFingerprints.has(fingerprint) ||
        inFlightFingerprints.has(fingerprint)
      ) {
        return;
      }

      const sendingFingerprint = fingerprint;
      const content = latestContentRef.current;
      inFlightFingerprints.add(sendingFingerprint);
      void postDwellUnit(
        `/api/books/${encodeURIComponent(bookId)}/artifacts/ingest`,
        JSON.stringify({
          fingerprint: sendingFingerprint,
          unitKind,
          locator,
          chapterLabel: content.chapterLabel,
          text: content.text,
        }),
        { retryNotFound: unitKind === "epub-spine", signal: controller.signal },
      )
        .then((wasSent) => {
          if (wasSent) sentFingerprints.add(sendingFingerprint);
        })
        .finally(() => inFlightFingerprints.delete(sendingFingerprint));
    };

    const resume = () => {
      if (
        cancelled ||
        timer ||
        !fingerprint ||
        sentFingerprints.has(fingerprint) ||
        !isEligible()
      ) {
        return;
      }
      if (remainingMs <= 0) {
        send();
        return;
      }
      startedAt = Date.now();
      timer = setTimeout(() => {
        timer = null;
        remainingMs = 0;
        send();
      }, remainingMs);
    };

    const syncTimer = () => {
      if (isEligible()) resume();
      else pause();
    };

    const handleVisibilityChange = () => syncTimer();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const panelVisibility = panelApi?.onDidVisibilityChange((event) => {
      panelVisible = event.isVisible;
      syncTimer();
    });
    const unsubscribeClusters = workspace?.subscribeClusterChanges(syncTimer);

    void computeFingerprint([userId, bookId, locator])
      .then((value) => {
        if (cancelled) return;
        fingerprint = value;
        resume();
      })
      .catch((error) => console.error("Failed to fingerprint reader dwell unit:", error));

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      panelVisibility?.dispose();
      unsubscribeClusters?.();
    };
  }, [
    bookId,
    dwellMs,
    enabled,
    hasText,
    isAuthenticated,
    locator,
    panelApi,
    unitKind,
    userId,
    workspace,
  ]);
}
