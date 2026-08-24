import { useCallback, useEffect, useState } from "react";

export type BugReportStatus =
  | "new"
  | "triaged"
  | "in_progress"
  | "resolved"
  | "closed"
  | "wont_fix";

export interface BugReport {
  id: string;
  message: string;
  status: BugReportStatus;
  createdAt: string;
  updatedAt: string;
}

interface BugReportsResponse {
  reports: BugReport[];
}

interface UseBugReportsOptions {
  enabled?: boolean;
}

export function useBugReports({ enabled = true }: UseBugReportsOptions = {}) {
  const [reports, setReports] = useState<BugReport[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const fetchReports = useCallback(
    async (signal?: AbortSignal) => {
      if (!enabled) {
        setReports([]);
        setError(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/bug-reports", {
          credentials: "include",
          signal,
        });

        if (!response.ok) {
          throw new Error("Could not load bug reports.");
        }

        const data = (await response.json()) as BugReportsResponse;
        setReports(
          [...data.reports].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
        );
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setReports([]);
        setError(cause instanceof Error ? cause.message : "Could not load bug reports.");
      } finally {
        if (!signal?.aborted) {
          setIsLoading(false);
        }
      }
    },
    [enabled],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchReports(controller.signal);
    return () => controller.abort();
  }, [fetchReports]);

  const refetch = useCallback(() => fetchReports(), [fetchReports]);

  return { reports, isLoading, error, refetch };
}
