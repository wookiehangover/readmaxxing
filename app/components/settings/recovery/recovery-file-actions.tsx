import { useSignals } from "@preact/signals-react/runtime";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog";
import { useAppStore } from "~/lib/themis/provider";
import { runRecoveryCommand } from "~/lib/themis/sync-recovery/sync-recovery-slice";

export function RecoveryFileActions() {
  useSignals();
  const store = useAppStore();
  const state = store.syncRecoverySelectors.selectRecoveryState().value;
  const view = state.view;
  const books = store.booksSelectors.selectAllBooks().value;
  const [targetId, setTargetId] = useState(view?.suggestedBookId ?? "");
  const [confirmation, setConfirmation] = useState<"file" | "cover" | null>(null);
  if (!view?.localFiles?.length) return null;
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <p className="text-sm">Recover original files to a current book on your account.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={targetId}
          disabled={!!view.fileTarget}
          onValueChange={(value) => setTargetId(value ?? "")}
        >
          <SelectTrigger aria-label="Book for file recovery">
            <SelectValue placeholder="Choose a book" />
          </SelectTrigger>
          <SelectContent>
            {view.suggestedBookId && !books.some((book) => book.id === view.suggestedBookId) && (
              <SelectItem value={view.suggestedBookId}>
                Original book ({view.suggestedBookId})
              </SelectItem>
            )}
            {books.map((book) => (
              <SelectItem key={book.id} value={book.id}>
                {book.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          disabled={state.busy || !targetId}
          onClick={() =>
            store.dispatch(
              runRecoveryCommand("review-file-target", view.token, undefined, targetId),
            )
          }
        >
          Review file destination
        </Button>
      </div>
      {view.fileTarget && (
        <>
          <p className="text-xs text-muted-foreground">
            The current destination is shown in the inspection above. Each action replaces only its
            selected file or cover. Refresh inspection to choose another destination. Other retained
            versions stay available.
          </p>
          <div className="flex flex-wrap gap-2">
            {view.localFiles.map((kind) => (
              <Button key={kind} disabled={state.busy} onClick={() => setConfirmation(kind)}>
                {kind === "file" ? "Upload original book file" : "Upload original cover"}
              </Button>
            ))}
          </div>
        </>
      )}
      <Dialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Replace this book’s {confirmation === "file" ? "file" : "cover"}?
            </DialogTitle>
            <DialogDescription>
              This uploads the exact original bytes you inspected to the reviewed book. If the book
              changed, the action stops for another review. The device snapshot stays retained,
              including other file versions.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmation(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (confirmation)
                  store.dispatch(
                    runRecoveryCommand(
                      confirmation === "file" ? "upload-file" : "upload-cover",
                      view.token,
                    ),
                  );
                setConfirmation(null);
              }}
            >
              Confirm file upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
