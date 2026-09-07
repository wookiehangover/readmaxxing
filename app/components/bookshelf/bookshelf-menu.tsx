import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  Edit3,
  Ellipsis,
  MessageSquare,
  NotebookPen,
  RefreshCw,
  Share2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { ShareDialog } from "~/components/share-dialog";
import { useBookDeletion } from "~/hooks/use-book-deletion";
import { useAuth } from "~/lib/context/auth-context";
import { useWorkspace } from "~/lib/context/workspace-context";
import { ensureLocalThenOpen } from "~/lib/library-book-open";
import type { BookMeta } from "~/lib/stores/book-store";
import { useSyncActions } from "~/lib/sync/use-sync";
import { useAppStore } from "~/lib/themis/provider";

export function BookshelfMenu({ book }: { book: BookMeta }) {
  const ws = useWorkspace();
  const store = useAppStore();
  const { isAuthenticated } = useAuth();
  const { reloadBookFiles, isActive: syncActive } = useSyncActions();
  const [sharing, setSharing] = useState(false);
  const pendingOpen = useRef<AbortController | null>(null);
  const { handleDeleteBook } = useBookDeletion({
    onBookDeleted: (id) => ws.onBookDeletedRef.current?.(id),
  });
  useEffect(() => () => pendingOpen.current?.abort(), []);

  async function openRail(rail: "notebook" | "chat") {
    pendingOpen.current?.abort();
    const controller = new AbortController();
    pendingOpen.current = controller;
    try {
      await ensureLocalThenOpen(book, {
        store,
        signal: controller.signal,
        openBook: (localBook) => {
          if (rail === "notebook") ws.openNotebookRef.current?.(localBook);
          else ws.openChatRef.current?.(localBook);
        },
      });
    } catch {
      toast.error(`Could not download “${book.title}”. Please try again.`);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`More actions for ${book.title}`}
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
            />
          }
        >
          <Ellipsis aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto">
          <DropdownMenuItem onClick={() => void openRail("notebook")}>
            <NotebookPen />
            Open notebook
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void openRail("chat")}>
            <MessageSquare />
            Open chat
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link to={`/books/${encodeURIComponent(book.id)}/details`} />}>
            <Edit3 />
            Edit
          </DropdownMenuItem>
          {isAuthenticated && (
            <DropdownMenuItem
              onClick={() => {
                if (!book.remoteFileUrl)
                  toast.warning("Sign in and sync this book before sharing it.");
                else setSharing(true);
              }}
            >
              <Share2 />
              Share
            </DropdownMenuItem>
          )}
          {syncActive && (
            <DropdownMenuItem
              onClick={() =>
                void reloadBookFiles(book.id).catch(() =>
                  toast.error("Could not sync this book. Please try again."),
                )
              }
            >
              <RefreshCw />
              Sync
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onClick={() => handleDeleteBook(book.id)}>
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ShareDialog book={book} open={sharing} onOpenChange={setSharing} />
    </>
  );
}
