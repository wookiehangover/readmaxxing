import { useCallback, useEffect, useMemo, useState } from "react";
import { Effect } from "effect";
import type { IDockviewPanelProps } from "dockview";
import { BookOpen, Trash2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { useEffectQuery } from "~/hooks/use-effect-query";
import { useWorkspace } from "~/lib/context/workspace-context";
import { AppRuntime } from "~/lib/effect-runtime";
import {
  ReadingHistoryService,
  type ReadingHistoryEntry,
} from "~/lib/stores/reading-history-store";

interface ReadingHistoryPanelParams {
  readonly bookId: string;
  readonly bookTitle: string;
}

interface GroupedReadingHistory {
  readonly key: string;
  readonly label: string;
  readonly entries: ReadingHistoryEntry[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function getDayStart(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatDayLabel(timestamp: number): string {
  const dayStart = getDayStart(timestamp);
  const todayStart = getDayStart(Date.now());
  const dayDiff = Math.round((todayStart - dayStart) / DAY_MS);

  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Yesterday";

  const date = new Date(timestamp);
  const includeYear = date.getFullYear() !== new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  });
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function groupHistoryByDay(history: ReadingHistoryEntry[]): GroupedReadingHistory[] {
  const groups = new Map<string, GroupedReadingHistory>();

  for (const entry of history) {
    const key = String(getDayStart(entry.timestamp));
    const group = groups.get(key);
    if (group) {
      group.entries.push(entry);
    } else {
      groups.set(key, {
        key,
        label: formatDayLabel(entry.timestamp),
        entries: [entry],
      });
    }
  }

  return [...groups.values()];
}

export function ReadingHistoryPanel({ params }: IDockviewPanelProps<ReadingHistoryPanelParams>) {
  const { bookId, bookTitle } = params;
  const { navigateInCluster } = useWorkspace();
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingEntries, setPendingEntries] = useState<ReadingHistoryEntry[]>([]);
  const [isClearing, setIsClearing] = useState(false);

  const {
    data: history,
    error,
    isLoading,
  } = useEffectQuery(
    () => ReadingHistoryService.pipe(Effect.andThen((s) => s.getHistory(bookId))),
    [bookId, refreshKey],
  );

  const entries = useMemo(() => [...pendingEntries, ...(history ?? [])], [pendingEntries, history]);
  const groupedHistory = useMemo(() => groupHistoryByDay(entries), [entries]);

  useEffect(() => {
    setPendingEntries([]);
  }, [bookId, history, refreshKey]);

  useEffect(() => {
    function handleReadingHistoryUpdated(event: Event) {
      const detail = (
        event as CustomEvent<{
          readonly bookId?: string;
          readonly entry?: ReadingHistoryEntry;
        }>
      ).detail;
      if (detail?.bookId !== bookId) return;
      const { entry } = detail;
      if (entry) {
        setPendingEntries((prev) => [entry, ...prev]);
      } else {
        setPendingEntries([]);
        setRefreshKey((key) => key + 1);
      }
    }

    window.addEventListener("reading-history:updated", handleReadingHistoryUpdated);
    return () => {
      window.removeEventListener("reading-history:updated", handleReadingHistoryUpdated);
    };
  }, [bookId]);

  const handleClearHistory = useCallback(() => {
    if (entries.length === 0 || isClearing) return;
    if (!window.confirm(`Clear reading history for "${bookTitle}"?`)) return;

    setIsClearing(true);
    AppRuntime.runPromise(ReadingHistoryService.pipe(Effect.andThen((s) => s.clearHistory(bookId))))
      .then(() => {
        setIsClearing(false);
      })
      .catch((err: unknown) => {
        console.error("Failed to clear reading history:", err);
        setIsClearing(false);
      });
  }, [bookId, bookTitle, entries.length, isClearing]);

  const handleNavigateToEntry = useCallback(
    (cfi: string) => {
      navigateInCluster(bookId, cfi).catch((err: unknown) => {
        console.error("Failed to navigate from reading history:", err);
      });
    },
    [bookId, navigateInCluster],
  );

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="truncate text-sm font-semibold">Reading history</h2>
        <p className="truncate text-xs text-muted-foreground">{bookTitle}</p>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {isLoading ? (
          <div className="flex h-full items-center justify-center p-6">
            <p className="text-sm text-muted-foreground">Loading history…</p>
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center p-6">
            <p className="text-sm text-muted-foreground">Unable to load reading history.</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <BookOpen className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">No reading history yet</p>
            <p className="text-xs text-muted-foreground">
              Pages you read in this book will appear here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6 p-4">
            {groupedHistory.map((group) => (
              <section key={group.key} className="flex flex-col gap-3">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {group.label}
                </h3>
                <table className="w-full table-fixed text-left text-sm">
                  <thead>
                    <tr>
                      <th className="w-[120px] pb-1 text-left text-[10px] font-normal text-muted-foreground/60">
                        Time
                      </th>
                      <th className="w-16 pb-1 text-left text-[10px] font-normal text-muted-foreground/60">
                        Page
                      </th>
                      <th className="w-auto pb-1 text-left text-[10px] font-normal text-muted-foreground/60">
                        Chapter
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.entries.map((entry) => (
                      <tr
                        key={entry.id}
                        className="cursor-pointer transition-colors hover:bg-accent/50"
                        onClick={() => handleNavigateToEntry(entry.cfi)}
                      >
                        <td className="w-[120px] whitespace-nowrap py-1.5 pr-5 text-xs tabular-nums text-muted-foreground">
                          {formatTime(entry.timestamp)}
                        </td>
                        <td className="w-16 whitespace-nowrap py-1.5 pr-3 tabular-nums">
                          {entry.pageIndex ?? "—"}
                        </td>
                        <td className="max-w-0 truncate py-1.5 text-xs text-muted-foreground">
                          {entry.chapterLabel ?? "Unknown chapter"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
        )}
      </ScrollArea>

      <div className="border-t p-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          disabled={entries.length === 0 || isClearing}
          onClick={handleClearHistory}
        >
          <Trash2 data-icon="inline-start" />
          {isClearing ? "Clearing…" : "Clear history"}
        </Button>
      </div>
    </div>
  );
}
