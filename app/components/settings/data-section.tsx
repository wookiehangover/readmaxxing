import { Effect } from "effect";
import { useEffect, useState } from "react";
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
import { AppRuntime } from "~/lib/effect-runtime";
import { exportBookData } from "~/lib/export/data-export";
import { BookService, type BookMeta } from "~/lib/stores/book-store";

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
  const [books, setBooks] = useState<BookMeta[]>([]);
  const [selectedBookId, setSelectedBookId] = useState("all");
  const [isExporting, setIsExporting] = useState(false);
  const [open, setOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  useEffect(() => {
    let active = true;
    AppRuntime.runPromise(BookService.pipe(Effect.andThen((service) => service.getBooks())))
      .then((loadedBooks) => {
        if (active) setBooks(loadedBooks);
      })
      .catch((cause) => {
        console.error(cause);
        toast("Could not load books");
      });

    return () => {
      active = false;
    };
  }, []);

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
