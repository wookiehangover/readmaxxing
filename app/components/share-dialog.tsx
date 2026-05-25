import { useEffect, useId, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { useAuth } from "~/lib/context/auth-context";
import type { BookMeta } from "~/lib/stores/book-store";

interface ShareDialogProps {
  book: BookMeta | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ShareResponse {
  url?: string;
  error?: string;
}

export function ShareDialog({ book, open, onOpenChange }: ShareDialogProps) {
  const { isAuthenticated } = useAuth();
  const limitUsesId = useId();
  const maxUsesId = useId();
  const shareChatsId = useId();
  const [limitUses, setLimitUses] = useState(false);
  const [maxUses, setMaxUses] = useState(1);
  const [shareChats, setShareChats] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setLimitUses(false);
      setMaxUses(1);
      setShareChats(false);
      setShareUrl(null);
      setCopied(false);
      setError(null);
    }
  }, [open, book?.id]);

  if (!isAuthenticated || !book) return null;
  const currentBook = book;

  async function handleCreateLink() {
    if (!currentBook.remoteFileUrl) {
      toast.warning("Sign in and sync this book before sharing it.");
      onOpenChange(false);
      return;
    }

    setIsCreating(true);
    setError(null);
    setCopied(false);

    try {
      const response = await fetch("/api/share", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId: currentBook.id,
          maxUses: limitUses ? maxUses : null,
          shareChats,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as ShareResponse;
      if (!response.ok || !body.url) throw new Error(body.error ?? "Failed to create share link");
      setShareUrl(body.url);
      toast.success("Share link created");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to create share link";
      setError(message);
      toast.error(message);
    } finally {
      setIsCreating(false);
    }
  }

  async function handleCopy() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success("Share link copied");
    } catch {
      toast.error("Could not copy share link");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share {currentBook.title}</DialogTitle>
          <DialogDescription>
            Create a link that lets someone import and read this book.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={limitUsesId} className="text-sm font-medium">
                Limit uses
              </label>
              <p className="text-xs text-muted-foreground">Leave off for an unlimited link.</p>
            </div>
            <Switch id={limitUsesId} checked={limitUses} onCheckedChange={setLimitUses} />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor={maxUsesId} className="text-sm font-medium">
              Maximum uses
            </label>
            <Input
              id={maxUsesId}
              type="number"
              min={1}
              step={1}
              value={maxUses}
              disabled={!limitUses || isCreating || Boolean(shareUrl)}
              onChange={(event) => setMaxUses(Math.max(1, Number(event.target.value) || 1))}
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={shareChatsId} className="text-sm font-medium">
                Share chats &amp; notes
              </label>
              <p className="text-xs text-muted-foreground">
                Recipients can view your related chats and notebook in read-only mode.
              </p>
            </div>
            <Switch id={shareChatsId} checked={shareChats} onCheckedChange={setShareChats} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {shareUrl && (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Check className="size-4" /> Share link ready
              </p>
              <div className="flex gap-2">
                <Input value={shareUrl} readOnly aria-label="Share URL" />
                <Button variant="outline" onClick={handleCopy}>
                  <Copy data-icon="inline-start" />
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {!shareUrl && (
            <Button onClick={handleCreateLink} disabled={isCreating}>
              {isCreating && <Loader2 data-icon="inline-start" className="animate-spin" />}
              Create Link
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
