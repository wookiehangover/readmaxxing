import { useCallback, useEffect, useState } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import { ListTree } from "lucide-react";
import { Streamdown } from "streamdown";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { fetchReadingArtifacts, ReadingArtifactsError } from "~/lib/reading-agent/artifacts-client";

export const OUTLINE_POLL_MS = 15_000;

interface OutlinePanelParams {
  readonly bookId: string;
  readonly bookTitle: string;
}

type OutlineStatus = "loading" | "ready" | "empty" | "auth" | "error";

interface OutlineState {
  readonly status: OutlineStatus;
  readonly content: string | null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function outlineFromContent(content: string | null | undefined): OutlineState {
  const trimmed = content?.trim() ?? "";
  if (!trimmed) return { status: "empty", content: null };
  return { status: "ready", content: trimmed };
}

function errorState(error: unknown): OutlineState {
  if (error instanceof ReadingArtifactsError && error.code === "auth_required") {
    return { status: "auth", content: null };
  }
  return { status: "error", content: null };
}

export function OutlinePanel({ params, api }: IDockviewPanelProps<OutlinePanelParams>) {
  const { bookId, bookTitle } = params;
  const [state, setState] = useState<OutlineState>({ status: "loading", content: null });
  const [refreshKey, setRefreshKey] = useState(0);

  const retry = useCallback(() => {
    setState({ status: "loading", content: null });
    setRefreshKey((key) => key + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let panelVisible = api?.isVisible ?? true;

    const clearPoll = () => {
      if (!pollTimer) return;
      clearTimeout(pollTimer);
      pollTimer = null;
    };

    const isVisible = () => document.visibilityState === "visible" && panelVisible;

    const load = async (silent: boolean) => {
      controller?.abort();
      controller = new AbortController();
      if (!silent)
        setState((current) =>
          current.status === "ready" ? current : { status: "loading", content: null },
        );
      try {
        const response = await fetchReadingArtifacts(bookId, { signal: controller.signal });
        if (cancelled) return;
        setState(outlineFromContent(response.artifacts.outline?.content));
      } catch (error) {
        if (cancelled || isAbortError(error)) return;
        setState((current) => (silent && current.status === "ready" ? current : errorState(error)));
      }
    };

    const schedulePoll = () => {
      clearPoll();
      if (!isVisible()) return;
      pollTimer = setTimeout(() => {
        pollTimer = null;
        if (!isVisible()) return;
        void load(true).then(schedulePoll);
      }, OUTLINE_POLL_MS);
    };

    const syncPolling = () => {
      if (isVisible()) schedulePoll();
      else clearPoll();
    };

    const handleVisibilityChange = () => {
      if (isVisible()) void load(true).then(syncPolling);
      else clearPoll();
    };
    const handleFocus = () => {
      if (isVisible()) void load(true).then(schedulePoll);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    const panelVisibility = api?.onDidVisibilityChange((event) => {
      panelVisible = event.isVisible;
      handleVisibilityChange();
    });

    void load(false).then(syncPolling);

    return () => {
      cancelled = true;
      controller?.abort();
      clearPoll();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      panelVisibility?.dispose();
    };
  }, [api, bookId, refreshKey]);

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="truncate text-sm font-semibold">Outline</h2>
        <p className="truncate text-xs text-muted-foreground">{bookTitle}</p>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {state.status === "loading" ? (
          <div className="flex h-full items-center justify-center p-6">
            <p className="text-sm text-muted-foreground">Loading outline…</p>
          </div>
        ) : state.status === "auth" ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Sign in to view the outline for <span className="italic">{bookTitle}</span>
            </p>
            <Button render={<a href="/login" />} nativeButton={false} variant="default">
              Sign in
            </Button>
          </div>
        ) : state.status === "error" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-muted-foreground">Unable to load the outline.</p>
            <Button type="button" variant="outline" size="sm" onClick={retry}>
              Retry
            </Button>
          </div>
        ) : state.status === "empty" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <ListTree className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">No outline yet</p>
            <p className="text-xs text-muted-foreground">
              Keep reading. An outline will appear here after a page has been in view long enough.
            </p>
          </div>
        ) : (
          <div className="typeset p-4 [--typeset-flow:0.75em] [--typeset-leading:1.6] [--typeset-size:0.875rem]">
            <Streamdown>{state.content ?? ""}</Streamdown>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
