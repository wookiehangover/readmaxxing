import { useEffect } from "react";
import type { DockviewPanelApi } from "dockview-react";
import { useAuth } from "~/lib/context/auth-context";
import { useOptionalWorkspace } from "~/lib/context/workspace-context";

export const READER_DWELL_MS = 10_000;

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

async function computeFingerprint(parts: readonly string[]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("")));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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

  useEffect(() => {
    if (!enabled || !isAuthenticated || !userId || !unitKind || !locator || !text) return;

    let cancelled = false;
    let fingerprint: string | null = null;
    let panelVisible = panelApi?.isVisible ?? true;
    let remainingMs = dwellMs;
    let startedAt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

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
      if (!fingerprint || sentFingerprints.has(fingerprint)) return;
      sentFingerprints.add(fingerprint);
      void fetch(`/api/books/${encodeURIComponent(bookId)}/artifacts/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fingerprint,
          unitKind,
          locator,
          chapterLabel,
          text,
        }),
      })
        .then((response) => {
          if (!response.ok) throw new Error(`Ingest returned ${response.status}`);
        })
        .catch((error) => console.error("Failed to ingest reader dwell unit:", error));
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

    void computeFingerprint([userId, bookId, unitKind, locator, text])
      .then((value) => {
        if (cancelled) return;
        fingerprint = value;
        resume();
      })
      .catch((error) => console.error("Failed to fingerprint reader dwell unit:", error));

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      panelVisibility?.dispose();
      unsubscribeClusters?.();
    };
  }, [
    bookId,
    chapterLabel,
    dwellMs,
    enabled,
    isAuthenticated,
    locator,
    panelApi,
    text,
    unitKind,
    userId,
    workspace,
  ]);
}
