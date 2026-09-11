import { RecoveryFileActions } from "./recovery-file-actions";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "~/components/ui/empty";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog";
import { useAppStore } from "~/lib/themis/provider";
import {
  refreshRecovery,
  selectRecovery,
  runRecoveryCommand,
} from "~/lib/themis/sync-recovery/sync-recovery-slice";
import type { RecoveryCommand, RecoveryItem } from "~/lib/themis/sync-recovery/sync-recovery-types";
import { useSyncListener } from "~/hooks/use-sync-listener";

const labels: Record<RecoveryItem["state"], string> = {
  received: "Saved on server · awaiting review",
  applied: "Applied",
  covered: "Already covered by saved data",
  waiting_clock: "Saved on server · waiting for edit time",
  waiting_dependency: "Saved on server · waiting for related data",
  retry_pending: "Saved on server · retry needed",
  needs_resolution: "Saved on server · not applied",
  resolved: "Decision saved",
  "needs-account-binding": "Saved on this device · sign in to sync",
  "local-not-received": "Saved on this device · not received by server",
  "raw-not-covered": "Original still on this device",
  "ownership-conflict": "Account needs review",
};

export function RecoverySection() {
  useSignals();
  const store = useAppStore();
  // View lifetime only: release the private preview when this section unmounts.
  useEffect(
    () => () => {
      store.dispatch(selectRecovery(null));
    },
    [store],
  );
  const state = store.syncRecoverySelectors.selectRecoveryState().value;
  const items = store.syncRecoverySelectors.selectRecoveryItems().value;
  const selected = store.syncRecoverySelectors.selectRecoveryItem().value;
  const user = store.authSessionSelectors.selectAuthUser().value;
  const [confirmation, setConfirmation] = useState<{
    command: RecoveryCommand;
    token: string;
  } | null>(null);
  useSyncListener(
    ["book", "notebook", "highlight", "bookmark", "position", "chat_session", "settings"],
    () => store.dispatch(refreshRecovery(true)),
  );
  const view = state.view;
  const confirmationText =
    confirmation?.command === "admit"
      ? {
          title: "Review this content with your account?",
          description:
            "Send the supported content to your account for recovery review. This does not apply the old edit or upload retained files. The exact original remains on this device, including values that cannot be sent as text.",
          button: "Send for review",
        }
      : confirmation?.command === "discard"
        ? {
            title: "Discard this device snapshot?",
            description:
              "This permanently removes only the original snapshot you inspected, including its retained file bytes. Downloading does not prove you saved a copy. Other snapshots and live library data are kept. This cannot be undone.",
            button: "Discard this snapshot",
          }
        : confirmation?.command === "submit_edit"
          ? {
              title:
                view?.resolution?.canonicalStatus === "missing"
                  ? "Create this missing notebook?"
                  : "Use this original content?",
              description:
                view?.resolution?.canonicalStatus === "missing"
                  ? "This creates the currently missing notebook using the original content you inspected. If someone saves this notebook first, the action stops for another review. Its book must still belong to your account and be available. The original snapshot stays retained."
                  : "This creates a new edit using the original content, replacing the current saved version you inspected. Both versions are shown above. If the saved version changed, the action stops for another review. The original snapshot stays retained.",
              button: "Confirm use original",
            }
          : confirmation?.command === "restore_copy"
            ? {
                title: "Restore this content as a copy?",
                description:
                  "This requests a separate copy using the original content. Some records cannot be copied, including books already saved with the same file. A rejected copy keeps the original for export.",
                button: "Confirm restore copy",
              }
            : {
                title: "Keep the current saved version?",
                description:
                  "This records your decision without applying the original edit. The original remains available to inspect and export. If the current version changed, you will need to review it again.",
                button: "Confirm keep current",
              };
  return (
    <section className="flex flex-col gap-6" aria-label="Recovery">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-lg text-sm text-muted-foreground">
          Find edits and original files kept during sync, including work from older versions.
          Inspect an original before deciding what to do.
        </p>
        <Button
          variant="outline"
          disabled={state.loading}
          onClick={() => store.dispatch(refreshRecovery(true))}
        >
          {state.loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      {!user && (
        <p className="text-sm text-muted-foreground">
          Device copies are available while signed out. Sign in to see work saved on your account.
        </p>
      )}
      {state.error && !state.selectedId && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.notice && !state.selectedId && (
        <Alert role="status">
          <AlertDescription>{state.notice}</AlertDescription>
        </Alert>
      )}
      {!state.loading && !items.length && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No retained work found</EmptyTitle>
            <EmptyDescription>Refresh after syncing to check again.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-4 rounded-lg border p-4"
          >
            <div className="flex min-w-0 flex-col gap-2">
              <span className="break-all text-sm font-medium">
                {item.entity} · {item.entityId}
              </span>
              <Badge variant="secondary">{labels[item.state]}</Badge>
              <span className="text-xs text-muted-foreground">
                {new Date(item.recordedAt).toLocaleString()}
              </span>
            </div>
            <Button variant="outline" onClick={() => store.dispatch(selectRecovery(item.id))}>
              Inspect
            </Button>
          </li>
        ))}
      </ul>
      <Dialog
        open={!!state.selectedId}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmation(null);
            store.dispatch(selectRecovery(null));
          }
        }}
      >
        <DialogContent className="flex max-h-[90dvh] flex-col overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Inspect retained work</DialogTitle>
            <DialogDescription>
              {selected ? labels[selected.state] : "Loading original…"}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <Button
              variant="outline"
              disabled={state.busy}
              onClick={() => store.dispatch(selectRecovery(selected.id))}
            >
              Refresh inspection
            </Button>
          )}
          {state.busy && (
            <p role="status" className="text-sm text-muted-foreground">
              Working…
            </p>
          )}
          {state.error && state.selectedId && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          {state.notice && state.selectedId && (
            <Alert role="status">
              <AlertDescription>{state.notice}</AlertDescription>
            </Alert>
          )}
          {view && (
            <iframe
              title="Original and current content"
              sandbox=""
              src={view.url}
              className="min-h-64 w-full flex-1 rounded-md border"
            />
          )}
          <p className="text-xs text-muted-foreground">
            Inspection and export keep the original. A metadata receipt does not mean an original
            book file was uploaded.
          </p>
          {view && selected?.source === "device" && user && (
            <RecoveryFileActions key={view.token} />
          )}
          {view && (
            <DialogFooter className="flex-wrap">
              <Button
                variant="outline"
                disabled={state.busy}
                onClick={() => store.dispatch(runRecoveryCommand("export", view.token))}
              >
                Export original
              </Button>
              {Array.from({ length: view.attachmentCount }, (_, index) => (
                <Button
                  key={index}
                  variant="outline"
                  disabled={state.busy}
                  onClick={() =>
                    store.dispatch(runRecoveryCommand("download-file", view.token, index))
                  }
                >
                  Download original file{view.attachmentCount > 1 ? ` ${index + 1}` : ""}
                </Button>
              ))}
              {view.resolution &&
                !["applied", "covered", "resolved"].includes(view.resolution.state) && (
                  <>
                    <Button
                      variant="outline"
                      disabled={state.busy}
                      onClick={() => store.dispatch(runRecoveryCommand("retry", view.token))}
                    >
                      Retry original edit
                    </Button>
                    <Button
                      disabled={state.busy}
                      onClick={() =>
                        setConfirmation({ command: "keep_canonical", token: view.token })
                      }
                    >
                      Keep current version
                    </Button>
                    {[
                      "book",
                      "notebook",
                      "position",
                      "highlight",
                      "bookmark",
                      "chat_session",
                      "settings",
                    ].includes(view.resolution.entity) &&
                      (view.resolution.canonicalStatus === "present" ||
                        (view.resolution.entity === "notebook" &&
                          view.resolution.canonicalStatus === "missing")) && (
                        <Button
                          disabled={state.busy}
                          onClick={() =>
                            setConfirmation({ command: "submit_edit", token: view.token })
                          }
                        >
                          Use original content
                        </Button>
                      )}
                    {["book", "highlight", "bookmark", "chat_session"].includes(
                      view.resolution.entity,
                    ) && (
                      <Button
                        variant="outline"
                        disabled={state.busy}
                        onClick={() =>
                          setConfirmation({ command: "restore_copy", token: view.token })
                        }
                      >
                        Restore as copy
                      </Button>
                    )}
                  </>
                )}
              {selected?.source === "device" && (
                <>
                  {user &&
                    !view.resolution &&
                    (view.localText || selected.entity === "local-recovery-admission") && (
                      <Button
                        disabled={state.busy}
                        onClick={() => setConfirmation({ command: "admit", token: view.token })}
                      >
                        {selected.entity === "local-recovery-admission"
                          ? "Retry content review"
                          : "Review content with account"}
                      </Button>
                    )}
                  {["recovery-resolution", "local-file-recovery"].includes(selected.entity) &&
                    user && (
                      <Button
                        variant="outline"
                        disabled={state.busy}
                        onClick={() => store.dispatch(runRecoveryCommand("retry", view.token))}
                      >
                        {selected.entity === "local-file-recovery"
                          ? "Retry file recovery"
                          : "Retry saved decision"}
                      </Button>
                    )}
                  <Button
                    variant="destructive"
                    disabled={state.busy || !view.localVersion}
                    onClick={() => setConfirmation({ command: "discard", token: view.token })}
                  >
                    Discard device snapshot
                  </Button>
                  {!view.localVersion && (
                    <p className="text-xs text-muted-foreground">
                      This original contains an unsupported value type. It remains retained; exact
                      export and discard are unavailable.
                    </p>
                  )}
                </>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!confirmation && confirmation.token === view?.token}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmationText.title}</DialogTitle>
            <DialogDescription>{confirmationText.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmation(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (confirmation)
                  store.dispatch(runRecoveryCommand(confirmation.command, confirmation.token));
                setConfirmation(null);
              }}
            >
              {confirmationText.button}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
