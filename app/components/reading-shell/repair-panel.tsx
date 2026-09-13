import { useSignals } from "@preact/signals-react/runtime";
import { Download, RefreshCw, Wrench } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { useAppStore } from "~/lib/themis/provider";
import { resumeRepair, saveRepair, startRepair } from "~/lib/themis/repairs/repairs-slice";
import { useSyncActions } from "~/lib/sync/use-sync";

export function RepairPanel({ bookId }: { bookId: string }) {
  useSignals();
  const store = useAppStore();
  const sync = useSyncActions();
  const { job, operation, error, replaced } = store.repairsSelectors.selectBookRepair(bookId).value;
  const busy = operation !== null;
  return (
    <section
      aria-label="Book repair"
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6 text-sm"
    >
      <div className="flex flex-col gap-2">
        <h2 className="font-medium">Repair this book</h2>
        <p className="text-muted-foreground">
          {operation === "starting"
            ? "Launching an agent to find and fix problems in this EPUB…"
            : job?.status === "running"
              ? "An agent has been launched to fix problems in this book. It checks the EPUB and renders each chapter as it works."
              : job?.status === "completed"
                ? "The repaired book passed EPUB validation and rendered every chapter. Save a copy or replace your library file."
                : "An agent can repair this EPUB in an isolated workspace and check that its chapters render properly."}
        </p>
        <p className="text-xs text-muted-foreground">
          Your original stays unchanged until you choose Replace original. Supports EPUBs up to 4
          MiB. Repaired downloads are available for seven days.
        </p>
      </div>
      {(error || job?.error) && (
        <Alert variant="destructive">
          <AlertTitle>Repair needs attention</AlertTitle>
          <AlertDescription>{error ?? job?.error}</AlertDescription>
        </Alert>
      )}
      {job && (
        <div
          role="log"
          aria-label="Repair diagnostics"
          aria-live="polite"
          className="flex flex-col gap-2"
        >
          {job.diagnostics.map((line, i) => (
            <p
              key={`${job.id}:${i}`}
              className="whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground"
            >
              {line}
            </p>
          ))}
        </div>
      )}
      {replaced && (
        <Alert>
          <AlertTitle>Library copy replaced</AlertTitle>
          <AlertDescription>
            The reader has reloaded the improved book. A backup of the original is stored on this
            device. Existing highlights and bookmarks may need checking if chapter locations
            changed.
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        {job?.status === "completed" ? (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => store.dispatch(saveRepair(bookId, "download", sync))}
            >
              <Download data-icon="inline-start" />
              Save a copy
            </Button>
            <Button
              size="sm"
              disabled={busy || replaced}
              onClick={() => store.dispatch(saveRepair(bookId, "replace", sync))}
            >
              <Wrench data-icon="inline-start" />
              {operation === "saving" ? "Saving…" : replaced ? "Replaced" : "Replace original"}
            </Button>
          </>
        ) : job?.status === "running" || error ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => store.dispatch(resumeRepair(bookId))}
          >
            <RefreshCw data-icon="inline-start" />
            Refresh status
          </Button>
        ) : null}
        {job?.status !== "running" && job?.status !== "completed" && (
          <Button size="sm" disabled={busy} onClick={() => store.dispatch(startRepair(bookId))}>
            <Wrench data-icon="inline-start" />
            {busy ? "Launching…" : job ? "Retry repair" : "Fix this book"}
          </Button>
        )}
      </div>
    </section>
  );
}
