import { useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { useAuth } from "~/lib/context/auth-context";

/** Delete every IndexedDB database owned by this origin. */
async function clearIndexedDB(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  if (typeof indexedDB.databases !== "function") return;

  const dbs = await indexedDB.databases();
  await Promise.all(
    dbs.map(
      (db) =>
        new Promise<void>((resolve) => {
          if (!db.name) {
            resolve();
            return;
          }
          const req = indexedDB.deleteDatabase(db.name);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
        }),
    ),
  );
}

/** Expire every client-readable cookie for this origin. */
function clearCookies(): void {
  if (typeof document === "undefined") return;

  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0]?.trim();
    if (!name) continue;
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

export function DataSection() {
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  async function handleReset() {
    setIsResetting(true);
    try {
      await clearIndexedDB();
      clearCookies();
      // Clears the HttpOnly session cookie server-side; ignore auth errors so a
      // failed logout never blocks the local reset.
      await logout().catch(() => {});

      toast.success("Local data cleared");
      setOpen(false);
      // Full reload to drop in-memory state and land in a signed-out session.
      window.location.href = "/";
    } catch (cause) {
      console.error(cause);
      toast("Could not reset local data");
      setIsResetting(false);
    }
  }

  return (
    <section className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start">
        <div className="max-w-md">
          <span className="block text-sm font-medium text-foreground">Reset local database</span>
          <p className="mt-1 text-sm text-muted-foreground">
            Deletes all locally stored books and reading data, clears cookies, and logs you out.
            This cannot be undone.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={
              <Button variant="destructive" className="max-sm:w-full">
                Reset local database
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reset local database?</DialogTitle>
              <DialogDescription>
                This permanently deletes all local data (books, positions, highlights, notebooks and
                chats), clears cookies, and logs you out. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" disabled={isResetting} />}>
                Cancel
              </DialogClose>
              <Button
                variant="destructive"
                onClick={() => void handleReset()}
                disabled={isResetting}
              >
                {isResetting ? "Resetting…" : "Reset"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </section>
  );
}
