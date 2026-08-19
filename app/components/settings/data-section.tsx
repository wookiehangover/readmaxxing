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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useAuth } from "~/lib/context/auth-context";
import { exportBookData } from "~/lib/export/data-export";
import { useAppStore } from "~/lib/themis/provider";

/**
 * App-owned IndexedDB database names. Used when `indexedDB.databases()` is
 * unavailable (e.g. some WebKit/Safari builds) so reset still targets real data.
 * Keep in sync with createStore(...) call sites under app/lib.
 */
const KNOWN_INDEXED_DB_NAMES = [
  "ebook-reader-db",
  "ebook-reader-book-data",
  "ebook-reader-positions",
  "ebook-reader-remote-positions",
  "ebook-reader-reading-history",
  "ebook-reader-highlights",
  "ebook-reader-bookmarks",
  "ebook-reader-notebooks",
  "ebook-reader-chat-sessions",
  "ebook-reader-active-session",
  "ebook-reader-chats",
  "ebook-reader-sync-flags",
  "ebook-reader-changelog",
  "ebook-reader-sync-cursors",
  "ebook-reader-chapter-uploads",
  "ebook-reader-workspace",
  "workspace-last-opened-db",
  "ebook-reader-book-prefs",
  "ebook-reader-locations",
] as const;

/**
 * Schedule deletion of one IndexedDB database.
 * Returns `"blocked"` when an open connection (this tab or another) is holding
 * the DB — the delete stays queued and typically finishes after reload drops
 * this tab's connections. Other tabs can still keep data alive.
 */
function deleteDatabase(name: string): Promise<"ok" | "blocked"> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve("ok");
    req.onerror = () => reject(req.error ?? new Error(`Failed to delete database "${name}"`));
    // Do not treat blocked as a hard failure: this tab often holds idb-keyval
    // connections open, so blocked is expected. Surface it to the caller.
    req.onblocked = () => resolve("blocked");
  });
}

/** Delete every IndexedDB database owned by this origin. */
async function clearIndexedDB(): Promise<{ blocked: boolean }> {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is not available in this browser");
  }

  let names: string[];
  if (typeof indexedDB.databases === "function") {
    const dbs = await indexedDB.databases();
    const discovered = dbs.map((db) => db.name).filter((name): name is string => Boolean(name));
    // Union with known names so incomplete listings still wipe app data.
    names = [...new Set([...discovered, ...KNOWN_INDEXED_DB_NAMES])];
  } else {
    names = [...KNOWN_INDEXED_DB_NAMES];
  }

  const results = await Promise.all(names.map(deleteDatabase));
  return { blocked: results.some((result) => result === "blocked") };
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

/** Clear localStorage and sessionStorage (settings, UI prefs, one-shot flags). */
function clearWebStorage(): void {
  try {
    localStorage.clear();
  } catch {
    // Private mode / disabled storage — best effort.
  }
  try {
    sessionStorage.clear();
  } catch {
    // Private mode / disabled storage — best effort.
  }
}

export function DataSection() {
  const { logout } = useAuth();
  const store = useAppStore();
  const books = store.booksSelectors.selectAllBooks.useValue();
  const [selectedBookId, setSelectedBookId] = useState("all");
  const [isExporting, setIsExporting] = useState(false);
  const [open, setOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  async function handleExport() {
    setIsExporting(true);
    try {
      const dataExport = await exportBookData(selectedBookId);
      if (!dataExport) {
        toast("Nothing to export");
        return;
      }

      const url = URL.createObjectURL(dataExport.blob);
      const anchor = document.createElement("a");
      try {
        anchor.href = url;
        anchor.download = dataExport.filename;
        document.body.append(anchor);
        anchor.click();
      } finally {
        anchor.remove();
        URL.revokeObjectURL(url);
      }
    } catch (cause) {
      console.error(cause);
      toast("Could not export data");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleReset() {
    setIsResetting(true);
    try {
      const { blocked } = await clearIndexedDB();
      clearWebStorage();
      clearCookies();
      // Clears the HttpOnly session cookie server-side; ignore auth errors so a
      // failed logout never blocks the local reset.
      await logout().catch(() => {});

      if (blocked) {
        toast.success("Local data cleared", {
          description: "If data remains, close other tabs for this site and reset again.",
        });
      } else {
        toast.success("Local data cleared");
      }
      setOpen(false);
      // Full reload drops in-memory state / open IDB connections so queued
      // deletes can finish, and lands in a signed-out session.
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
          <span className="block text-sm font-medium text-foreground">Export data</span>
          <p className="mt-1 text-sm text-muted-foreground">
            Download your notes and chats for one book or all books as a ZIP archive.
          </p>
        </div>
        <div className="flex items-center gap-2 max-sm:w-full">
          <Select
            items={[
              { value: "all", label: "All books" },
              ...books.map((book) => ({ value: book.id, label: book.title })),
            ]}
            value={selectedBookId}
            onValueChange={(value) => {
              if (value !== null) setSelectedBookId(value);
            }}
            disabled={isExporting}
          >
            <SelectTrigger aria-label="Book to export" className="w-56 max-sm:flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end" alignItemWithTrigger={false}>
              <SelectGroup>
                <SelectItem value="all">All books</SelectItem>
                {books.map((book) => (
                  <SelectItem key={book.id} value={book.id}>
                    {book.title}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button onClick={() => void handleExport()} disabled={isExporting}>
            {isExporting ? "Exporting…" : "Export"}
          </Button>
        </div>
      </div>
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
