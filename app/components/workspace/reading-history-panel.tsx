import { useCallback, useMemo, useState } from "react";
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
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatProgress(percentage: number): string {
  const clamped = Math.min(100, Math.max(0, percentage));
  return `${Math.round(clamped)}%`;
}

function formatEntryLocation(entry: ReadingHistoryEntry): string {
  if (entry.pageIndex !== null) return `Page ${entry.pageIndex}`;
  return `Location ${formatProgress(entry.percentage)}`;
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
  const [isClearing, setIsClearing] = useState(false);

  const {
    data: history,
    error,
    isLoading,
  } = useEffectQuery(
    () => ReadingHistoryService.pipe(Effect.andThen((s) => s.getHistory(bookId))),
    [bookId, refreshKey],
  );

  const entries = history ?? [];
  const groupedHistory = useMemo(() => groupHistoryByDay(entries), [entries]);

  const handleClearHistory = useCallback(() => {
    if (entries.length === 0 || isClearing) return;
    if (!window.confirm(`Clear reading history for "${bookTitle}"?`)) return;

    setIsClearing(true);
    AppRuntime.runPromise(ReadingHistoryService.pipe(Effect.andThen((s) => s.clearHistory(bookId))))
      .then(() => {
        setRefreshKey((key) => key + 1);
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
                <ol className="flex flex-col">
                  {group.entries.map((entry, index) => {
                    const isLast = index === group.entries.length - 1;
                    return (
                      <li key={entry.id} className="pb-2 last:pb-0">
                        <button
                          type="button"
                          className="flex w-full cursor-pointer gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => handleNavigateToEntry(entry.cfi)}
                        >
                          <time className="w-14 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">
                            {formatTime(entry.timestamp)}
                          </time>
                          <div className="relative flex w-3 shrink-0 justify-center">
                            <span className="mt-1.5 size-2 rounded-full border border-border bg-card" />
                            {!isLast && <span className="absolute top-4 bottom-0 w-px bg-border" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {entry.chapterLabel ?? "Unknown chapter"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatEntryLocation(entry)}
                            </p>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ol>
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
